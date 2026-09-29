import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { type BaseSdk } from "./interfaces/BaseSdk";
import { keccak256 } from "js-sha3";
import { ERC20_TRANSFER_SIGNATURE, KeyVars, NATIVE_TOKEN_ADDRESS, Provider } from "../shared/constants";
import { fromEvmChainId, resolveChain } from "../shared/chains";
import {
  eventFragmentFromAbi,
  eventSignatureFromAbi,
  getHeader,
  normaliseAddress,
  rawBodyToString,
  requireVar,
  safeCompare,
  SdkRequestError,
} from "../shared/utils";
import { Http } from "./Http";
import { get } from "lodash";

/**
 * Moralis Streams API.
 * https://docs.moralis.com/streams/api-reference/streams/create-streams
 *
 * Notes that bite people:
 * - Creating a stream is PUT, not POST.
 * - Auth is `x-api-key` (the API key). Callback signing uses the *streams secret*,
 *   which is a different value — hence two KeyVars.
 * - Callbacks are signed with keccak256(JSON.stringify(body) + secret), NOT HMAC
 *   and NOT NIST SHA3. `node:crypto`'s "sha3-256" is the wrong algorithm here.
 * - Addresses live on the stream, not in the create body: create, then POST the
 *   address to /streams/evm/{id}/address.
 */
const BASE_URL = "https://api.moralis-streams.com";

export class Moralis implements OnchainNotifier, BaseSdk {
  getClient = (options: SdkOptions): Http => {
    const apiKey = requireVar(options, KeyVars.MoralisApiKey, Provider.Moralis);

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
    const chainId = resolveChain(input.internalChainId, "moralis");
    const address = normaliseAddress(input.filter.address);
    const isNative =
      !input.filter.tokenAddress ||
      normaliseAddress(input.filter.tokenAddress) === NATIVE_TOKEN_ADDRESS;

    const body: Record<string, unknown> = {
      webhookUrl: input.webhookUrl,
      description: input.label ?? `track ${address}`,
      tag: input.label ?? `track-${address}`,
      chainIds: [chainId],
      includeNativeTxs: isNative,
      includeContractLogs: !isNative,
    };

    if (!isNative) {
      // Restrict to ERC-20 Transfer logs emitted by the one token we care about.
      body.topic0 = [ERC20_TRANSFER_SIGNATURE];
      body.abi = [ERC20_TRANSFER_ABI];
      body.advancedOptions = [
        {
          topic0: ERC20_TRANSFER_SIGNATURE,
          filter: buildTransferFilter(
            address,
            normaliseAddress(input.filter.tokenAddress!),
            input.filter.amount,
          ),
        },
      ];
    }

    const created = await client.put<MoralisStream>("/streams/evm", body);
    if (!created.is_ok || !created.data?.id) {
      throw new SdkRequestError(Provider.Moralis, "create stream", created);
    }

    const streamId = created.data.id;

    const attached = await client.post(`/streams/evm/${streamId}/address`, {
      address,
    });

    if (!attached.is_ok) {
      // Don't leak an orphaned stream that will never fire.
      await client.delete(`/streams/evm/${streamId}`);
      throw new SdkRequestError(Provider.Moralis, "add address to stream", attached);
    }

    return { correlationId: streamId };
  };

  trackEvent = async (
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);
    const chainId = resolveChain(input.internalChainId, "moralis");
    const contractAddress = normaliseAddress(input.filter.contractAddress);

    const signature =
      input.filter.eventSignature ??
      eventSignatureFromAbi(input.filter.contractAbi, input.filter.eventName);

    if (!signature) {
      throw new Error(
        `${Provider.Moralis}: trackEvent needs eventSignature or a contractAbi containing "${input.filter.eventName}"`,
      );
    }

    const fragment = eventFragmentFromAbi(
      input.filter.contractAbi,
      input.filter.eventName,
    );

    const body: Record<string, unknown> = {
      webhookUrl: input.webhookUrl,
      description: input.label ?? `event ${input.filter.eventName}`,
      tag: input.label ?? `event-${input.filter.eventName}`,
      chainIds: [chainId],
      includeContractLogs: true,
      topic0: [signature],
    };

    if (fragment) body.abi = [fragment];

    // Moralis can only filter on decoded params when it has the ABI for them.
    if (input.filter.match?.length && fragment) {
      body.advancedOptions = [
        {
          topic0: signature,
          filter: buildMatchFilter(input.filter.match),
        },
      ];
    }

    const created = await client.put<MoralisStream>("/streams/evm", body);
    if (!created.is_ok || !created.data?.id) {
      throw new SdkRequestError(Provider.Moralis, "create stream (event)", created);
    }

    const streamId = created.data.id;

    const attached = await client.post(`/streams/evm/${streamId}/address`, {
      address: contractAddress,
    });

    if (!attached.is_ok) {
      await client.delete(`/streams/evm/${streamId}`);
      throw new SdkRequestError(Provider.Moralis, "add address to stream", attached);
    }

    return { correlationId: streamId };
  };

  untrack = async (correlationId: string, options: SdkOptions): Promise<void> => {
    const client = this.getClient(options);

    const response = await client.delete(`/streams/evm/${correlationId}`);
    if (!response.is_ok) {
      throw new SdkRequestError(Provider.Moralis, "delete stream", response);
    }
  };

  isValidCallback = (
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): boolean => {
    const signature = getHeader(input.headers, "x-signature");
    if (!signature) return false;

    const secret = requireVar(options, KeyVars.MoralisStreamsSecret, Provider.Moralis);

    // Moralis: sha3 here means keccak256, and the secret is appended to the body.
    const digest = `0x${keccak256(`${rawBodyToString(input)}${secret}`)}`;

    return safeCompare(signature.toLowerCase(), digest.toLowerCase());
  };

  handleCallback = async (
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult> => {
    const correlationId = get(payload, "streamId") as string | undefined;
    const confirmed = Boolean(get(payload, "confirmed"));
    const internalChainId = fromEvmChainId(
      (get(payload, "chainId") as string) ?? "",
    )?.internalChainId;

    const blockNumber = Number(get(payload, "block.number", undefined));
    const activities: OnchainActivity[] = [];

    for (const tx of get(payload, "txs", []) as any[]) {
      activities.push({
        kind: "transfer",
        internalChainId,
        blockNumber: Number.isFinite(blockNumber) ? blockNumber : undefined,
        transactionHash: tx.hash,
        from: tx.fromAddress,
        to: tx.toAddress,
        value: tx.value,
      });
    }

    for (const transfer of get(payload, "erc20Transfers", []) as any[]) {
      activities.push({
        kind: "transfer",
        internalChainId,
        blockNumber: Number.isFinite(blockNumber) ? blockNumber : undefined,
        transactionHash: transfer.transactionHash,
        logIndex:
          transfer.logIndex === undefined
            ? undefined
            : Number(transfer.logIndex),
        from: transfer.from,
        to: transfer.to,
        value: transfer.value,
        tokenAddress: transfer.contract,
        tokenSymbol: transfer.tokenSymbol,
        tokenDecimals:
          transfer.tokenDecimals === undefined
            ? undefined
            : Number(transfer.tokenDecimals),
      });
    }

    for (const log of get(payload, "logs", []) as any[]) {
      activities.push({
        kind: "event",
        internalChainId,
        blockNumber: Number.isFinite(blockNumber) ? blockNumber : undefined,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex === undefined ? undefined : Number(log.logIndex),
        contractAddress: log.address,
        topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
          (t): t is string => Boolean(t),
        ),
        data: log.data,
        params: log.decoded ?? undefined,
      });
    }

    return { correlationId, confirmed, activities };
  };
}

type MoralisStream = {
  id: string;
  status: "active" | "paused" | "error" | "terminated";
  webhookUrl: string;
};

const ERC20_TRANSFER_ABI = {
  anonymous: false,
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
  name: "Transfer",
  type: "event",
};

/** Moralis advancedOptions filters use Mongo-ish operators without the leading underscore. */
const MORALIS_OPERATOR: Record<ComparisonOperator, string> = {
  _eq: "eq",
  _neq: "ne",
  _gt: "gt",
  _gte: "gte",
  _lt: "lt",
  _lte: "lte",
};

const buildTransferFilter = (
  address: string,
  tokenAddress: string,
  amount?: { operation: ThresholdOperator; value: string },
): Record<string, unknown> => {
  const clauses: Record<string, unknown>[] = [
    { or: [{ eq: ["from", address] }, { eq: ["to", address] }] },
    { eq: ["contract", tokenAddress] },
  ];

  if (amount) {
    clauses.push({
      [MORALIS_OPERATOR[amount.operation as ComparisonOperator]]: [
        "value",
        amount.value,
      ],
    });
  }

  return { and: clauses };
};

const buildMatchFilter = (
  match: NonNullable<OnchainNotifierTrackEventInput["filter"]["match"]>,
): Record<string, unknown> => ({
  and: match.map((m) => ({
    [MORALIS_OPERATOR[m.operation]]: [m.param, m.value],
  })),
});
