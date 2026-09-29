import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { type BaseSdk } from "./interfaces/BaseSdk";
import { createHmac } from "node:crypto";
import { ERC20_TRANSFER_SIGNATURE, KeyVars, NATIVE_TOKEN_ADDRESS, Provider } from "../shared/constants";
import { CHAINS, resolveChain } from "../shared/chains";
import {
  eventSignatureFromAbi,
  getHeader,
  normaliseAddress,
  rawBodyToString,
  requireVar,
  safeCompare,
  SdkRequestError,
  toTopic0,
} from "../shared/utils";
import { Http } from "./Http";
import { get } from "lodash";

/**
 * QuickNode QuickAlerts REST API.
 * https://www.quicknode.com/docs/quickalerts/rest-api/notifications/quickalerts-rest-create-notification
 *
 * QuickAlerts splits the two halves of a webhook:
 *   - a *destination* is the URL that receives payloads (reusable, created once)
 *   - a *notification* is the filter expression bound to one or more destinations
 * so `track` reuses a configured destination when `QuickNodeDestinationId` is set
 * and otherwise creates one for this webhook URL.
 *
 * The filter is a QuickAlerts expression, submitted base64-encoded.
 *
 * Callbacks are signed with HMAC-SHA256 over `nonce + timestamp + payload`,
 * keyed by the destination's security token, and split across three headers.
 */
const BASE_URL = "https://api.quicknode.com/quickalerts/rest/v1";

export class QuickNode implements OnchainNotifier, BaseSdk {
  getClient = (options: SdkOptions): Http => {
    const apiKey = requireVar(options, KeyVars.QuickNodeApiKey, Provider.QuickNode);

    return new Http(BASE_URL, {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  };

  track = async (
    input: OnchainNotifierTrackInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);
    const network = resolveChain(input.internalChainId, "quicknode");
    const address = normaliseAddress(input.filter.address);

    const isNative =
      !input.filter.tokenAddress ||
      normaliseAddress(input.filter.tokenAddress) === NATIVE_TOKEN_ADDRESS;

    const expression = isNative
      ? buildNativeExpression(address, input.filter.amount)
      : buildTokenTransferExpression(
          address,
          normaliseAddress(input.filter.tokenAddress!),
          input.filter.amount,
        );

    return this.createNotification(
      client,
      {
        name: input.label ?? `track-${address}`,
        expression,
        network,
      },
      input.webhookUrl,
      options,
    );
  };

  trackEvent = async (
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);
    const network = resolveChain(input.internalChainId, "quicknode");

    const signature =
      input.filter.eventSignature ??
      eventSignatureFromAbi(input.filter.contractAbi, input.filter.eventName);

    if (!signature) {
      throw new Error(
        `${Provider.QuickNode}: trackEvent needs eventSignature or a contractAbi containing "${input.filter.eventName}"`,
      );
    }

    const clauses = [
      `tx_logs_address == '${normaliseAddress(input.filter.contractAddress)}'`,
      `tx_logs_topic0 == '${toTopic0(signature)}'`,
    ];

    // Indexed params land in topic1..topic3 in declaration order; anything
    // non-indexed lives in `data` and has to be matched after decoding, so it is
    // deliberately left to the callback layer rather than faked into the expression.
    for (const m of input.filter.match ?? []) {
      const topic = indexedTopicFor(input.filter.contractAbi, input.filter.eventName, m.param);
      if (!topic) continue;
      const operator = QUICKNODE_OPERATOR[m.operation];
      clauses.push(`tx_logs_${topic} ${operator} '${padTopicValue(m.value)}'`);
    }

    return this.createNotification(
      client,
      {
        name: input.label ?? `event-${input.filter.eventName}`,
        expression: clauses.join(" && "),
        network,
      },
      input.webhookUrl,
      options,
    );
  };

  untrack = async (correlationId: string, options: SdkOptions): Promise<void> => {
    const client = this.getClient(options);

    const response = await client.delete(`/notifications/${correlationId}`);
    if (!response.is_ok) {
      throw new SdkRequestError(Provider.QuickNode, "delete notification", response);
    }
  };

  isValidCallback = (
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): boolean => {
    const signature = getHeader(input.headers, "x-qn-signature");
    const nonce = getHeader(input.headers, "x-qn-nonce");
    const timestamp = getHeader(input.headers, "x-qn-timestamp");

    if (!signature || !nonce || !timestamp) return false;

    const token = requireVar(options, KeyVars.QuickNodeSecurityToken, Provider.QuickNode);

    // Signed over the decompressed UTF-8 payload — if the body arrived gzipped,
    // `rawBody` must already be the decoded string, not the wire bytes.
    const digest = createHmac("sha256", token)
      .update(`${nonce}${timestamp}${rawBodyToString(input)}`, "utf8")
      .digest("hex");

    return safeCompare(signature.toLowerCase(), digest.toLowerCase());
  };

  handleCallback = async (
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult> => {
    // QuickAlerts delivers the matched logs, either bare or wrapped per payload type.
    const logs = (
      Array.isArray(payload) ? payload : get(payload, "data", payload)
    ) as any;

    const entries: any[] = Array.isArray(logs) ? logs : [logs];
    const network = get(payload, "network") as string | undefined;
    const internalChainId = Object.values(CHAINS).find(
      (c) => c.quicknode === network,
    )?.internalChainId;

    const activities: OnchainActivity[] = entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        kind: "event" as const,
        internalChainId,
        blockNumber:
          entry.blockNumber === undefined
            ? undefined
            : Number(BigInt(entry.blockNumber)),
        transactionHash: entry.transactionHash,
        logIndex:
          entry.logIndex === undefined
            ? undefined
            : Number(BigInt(entry.logIndex)),
        contractAddress: entry.address,
        topics: entry.topics,
        data: entry.data,
      }));

    return {
      correlationId: get(payload, "notificationId") as string | undefined,
      confirmed: true,
      activities,
    };
  };

  /** Resolve (or create) a destination, then bind a notification to it. */
  private createNotification = async (
    client: Http,
    notification: { name: string; expression: string; network: string },
    webhookUrl: string,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const destinationId =
      options.variables?.[KeyVars.QuickNodeDestinationId] ??
      (await this.createDestination(client, notification.name, webhookUrl));

    const response = await client.post<QuickNodeNotification>("/notifications", {
      name: notification.name,
      expression: Buffer.from(notification.expression, "utf8").toString(
        "base64",
      ),
      network: notification.network,
      destinationIds: [destinationId],
      enabled: true,
    });

    if (!response.is_ok || !response.data?.id) {
      throw new SdkRequestError(Provider.QuickNode, "create notification", response);
    }

    return { correlationId: response.data.id };
  };

  private createDestination = async (
    client: Http,
    name: string,
    webhookUrl: string,
  ): Promise<string> => {
    const response = await client.post<QuickNodeDestination>("/destinations", {
      name: `${name}-destination`,
      to_url: webhookUrl,
      webhook_type: "POST",
      service: "webhook",
      payload_type: 5, // 5 = matched logs
    });

    if (!response.is_ok || !response.data?.id) {
      throw new SdkRequestError(Provider.QuickNode, "create destination", response);
    }

    return response.data.id;
  };
}

type QuickNodeNotification = { id: string; name: string; expression: string };
type QuickNodeDestination = { id: string; name: string; to_url: string };

const QUICKNODE_OPERATOR: Record<ComparisonOperator, string> = {
  _eq: "==",
  _neq: "!=",
  _gt: ">",
  _gte: ">=",
  _lt: "<",
  _lte: "<=",
};

const buildNativeExpression = (
  address: string,
  amount?: { operation: ThresholdOperator; value: string },
): string => {
  const clauses = [`(tx_from == '${address}' || tx_to == '${address}')`];

  if (amount) {
    clauses.push(
      `tx_value ${QUICKNODE_OPERATOR[amount.operation as ComparisonOperator]} ${amount.value}`,
    );
  }

  return clauses.join(" && ");
};

const buildTokenTransferExpression = (
  address: string,
  tokenAddress: string,
  amount?: { operation: ThresholdOperator; value: string },
): string => {
  const padded = padTopicValue(address);

  const clauses = [
    `tx_logs_address == '${tokenAddress}'`,
    `tx_logs_topic0 == '${toTopic0(ERC20_TRANSFER_SIGNATURE)}'`,
    `(tx_logs_topic1 == '${padded}' || tx_logs_topic2 == '${padded}')`,
  ];

  if (amount) {
    clauses.push(
      `tx_logs_data ${QUICKNODE_OPERATOR[amount.operation as ComparisonOperator]} ${amount.value}`,
    );
  }

  return clauses.join(" && ");
};

/** Topics are 32 bytes; an address has to be left-padded to match. */
const padTopicValue = (value: string): string => {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  return `0x${hex.toLowerCase().padStart(64, "0")}`;
};

/** Which topic slot an indexed param occupies, or undefined if it isn't indexed. */
const indexedTopicFor = (
  abi: Record<string, unknown> | undefined,
  eventName: string,
  param: string,
): string | undefined => {
  if (!abi) return undefined;

  const fragments: any[] = Array.isArray(abi)
    ? (abi as any[])
    : Array.isArray((abi as any).abi)
      ? (abi as any).abi
      : [abi];

  const fragment = fragments.find(
    (f) => f && f.type === "event" && f.name === eventName,
  );
  if (!fragment) return undefined;

  const indexed = (fragment.inputs ?? []).filter((i: any) => i.indexed);
  const position = indexed.findIndex((i: any) => i.name === param);

  return position === -1 ? undefined : `topic${position + 1}`;
};
