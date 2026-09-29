import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { type BaseSdk } from "./interfaces/BaseSdk";
import { createHmac } from "node:crypto";
import { KeyVars, NATIVE_TOKEN_ADDRESS, Provider } from "../shared/constants";
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
 * Nodit Webhook API.
 * https://developer.nodit.io/en/api/ethereum/webhook-api/createwebhook
 *
 * - Network is encoded in the path: /v1/{protocol}/{network}/webhooks.
 *   Because of that the client is chain-scoped, so `getClient` builds against
 *   mainnet Ethereum and the chain-aware calls use `getClientForChain`.
 * - Auth is `X-API-KEY`; callbacks are HMAC-SHA256 signed with the per-subscription
 *   signingKey returned at creation time, sent in `x-signature`.
 * - `untrack` needs the chain too, so correlationId encodes it as
 *   "{protocol}/{network}/{subscriptionId}".
 */
const BASE_URL = "https://web3.nodit.io";

export class Nodit implements OnchainNotifier, BaseSdk {
  getClient = (options: SdkOptions): Http => {
    const apiKey = requireVar(options, KeyVars.NoditApiKey, Provider.Nodit);

    return new Http(BASE_URL, {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  };

  track = async (
    input: OnchainNotifierTrackInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);
    const { protocol, network } = resolveChain(input.internalChainId, "nodit");
    const address = normaliseAddress(input.filter.address);

    const isNative =
      !input.filter.tokenAddress ||
      normaliseAddress(input.filter.tokenAddress) === NATIVE_TOKEN_ADDRESS;

    // ADDRESS_ACTIVITY covers native movement; TOKEN_TRANSFER narrows to one token.
    const body = isNative
      ? {
          eventType: "ADDRESS_ACTIVITY",
          description: input.label ?? `track ${address}`,
          notification: { webhookUrl: input.webhookUrl },
          condition: { addresses: [address] },
        }
      : {
          eventType: "TOKEN_TRANSFER",
          description: input.label ?? `track ${address}`,
          notification: { webhookUrl: input.webhookUrl },
          condition: {
            addresses: [address],
            tokenAddresses: [normaliseAddress(input.filter.tokenAddress!)],
          },
        };

    const response = await client.post<NoditWebhook>(
      `/v1/${protocol}/${network}/webhooks`,
      body,
    );

    if (!response.is_ok || !response.data?.subscriptionId) {
      throw new SdkRequestError(Provider.Nodit, "create webhook", response);
    }

    return {
      correlationId: encodeCorrelationId(
        protocol,
        network,
        response.data.subscriptionId,
      ),
    };
  };

  trackEvent = async (
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);
    const { protocol, network } = resolveChain(input.internalChainId, "nodit");

    const signature =
      input.filter.eventSignature ??
      eventSignatureFromAbi(input.filter.contractAbi, input.filter.eventName);

    if (!signature) {
      throw new Error(
        `${Provider.Nodit}: trackEvent needs eventSignature or a contractAbi containing "${input.filter.eventName}"`,
      );
    }

    const response = await client.post<NoditWebhook>(
      `/v1/${protocol}/${network}/webhooks`,
      {
        eventType: "LOG",
        description: input.label ?? `event ${input.filter.eventName}`,
        notification: { webhookUrl: input.webhookUrl },
        condition: {
          address: normaliseAddress(input.filter.contractAddress),
          topics: [toTopic0(signature)],
        },
      },
    );

    if (!response.is_ok || !response.data?.subscriptionId) {
      throw new SdkRequestError(Provider.Nodit, "create webhook (log)", response);
    }

    return {
      correlationId: encodeCorrelationId(
        protocol,
        network,
        response.data.subscriptionId,
      ),
    };
  };

  untrack = async (correlationId: string, options: SdkOptions): Promise<void> => {
    const client = this.getClient(options);
    const { protocol, network, subscriptionId } =
      decodeCorrelationId(correlationId);

    const response = await client.delete(
      `/v1/${protocol}/${network}/webhooks/${subscriptionId}`,
    );

    if (!response.is_ok) {
      throw new SdkRequestError(Provider.Nodit, "delete webhook", response);
    }
  };

  isValidCallback = (
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): boolean => {
    const signature = getHeader(input.headers, "x-signature");
    if (!signature) return false;

    const signingKey = requireVar(options, KeyVars.NoditSigningKey, Provider.Nodit);

    const digest = createHmac("sha256", signingKey)
      .update(rawBodyToString(input), "utf8")
      .digest("hex");

    return safeCompare(signature.toLowerCase(), digest.toLowerCase());
  };

  handleCallback = async (
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult> => {
    const subscriptionId = get(payload, "subscriptionId") as string | undefined;
    const protocol = get(payload, "protocol") as string | undefined;
    const network = get(payload, "network") as string | undefined;
    const eventType = get(payload, "eventType") as string | undefined;

    const internalChainId = Object.values(CHAINS).find(
      (c) => c.nodit?.protocol === protocol && c.nodit?.network === network,
    )?.internalChainId;

    const correlationId =
      protocol && network && subscriptionId
        ? encodeCorrelationId(protocol, network, subscriptionId)
        : subscriptionId;

    const items = get(payload, "event.messages", []) as any[];

    const activities: OnchainActivity[] =
      eventType === "LOG"
        ? items.map((log) => ({
            kind: "event" as const,
            internalChainId,
            blockNumber:
              log.block_number === undefined
                ? undefined
                : Number(log.block_number),
            transactionHash: log.transaction_hash,
            logIndex: log.log_index === undefined ? undefined : Number(log.log_index),
            contractAddress: log.contract_address ?? log.address,
            topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
              (t): t is string => Boolean(t),
            ),
            data: log.data,
          }))
        : items.map((item) => ({
            kind: "transfer" as const,
            internalChainId,
            blockNumber:
              item.block_number === undefined
                ? undefined
                : Number(item.block_number),
            transactionHash: item.transaction_hash ?? item.hash,
            from: item.from_address ?? item.from,
            to: item.to_address ?? item.to,
            value: item.value,
            tokenAddress: item.contract_address,
          }));

    return { correlationId, confirmed: true, activities };
  };
}

type NoditWebhook = {
  subscriptionId: string;
  protocol: string;
  network: string;
  eventType: string;
  notification: { webhookUrl: string; signingKey: string };
  createdAt: string;
};

const encodeCorrelationId = (
  protocol: string,
  network: string,
  subscriptionId: string,
): string => `${protocol}/${network}/${subscriptionId}`;

const decodeCorrelationId = (
  correlationId: string,
): { protocol: string; network: string; subscriptionId: string } => {
  const [protocol, network, subscriptionId] = correlationId.split("/");

  if (!protocol || !network || !subscriptionId) {
    throw new Error(
      `${Provider.Nodit}: expected correlationId "{protocol}/{network}/{subscriptionId}", got "${correlationId}"`,
    );
  }

  return { protocol, network, subscriptionId };
};
