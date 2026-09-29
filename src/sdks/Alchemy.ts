import { AppError, NotFoundError, SdkRequestError } from "../shared/errors";
import { providerDescriptorOfChain } from "../shared/chains";
import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { KeyVars, Provider } from "../shared/constants";
import { CallbackRequestService } from "../services/CallbackRequest.service";
import { type GasSponsor } from "./interfaces/GasSponsor";
import { type BaseSdk } from "./interfaces/BaseSdk";
import { createHmac } from "node:crypto";
import { SdkHelper } from "./helper/SdkHelper";
import { type Abi } from "viem";
import { Http } from "./Http";
import { get } from "lodash";
import { KiteFactory__factory } from "@kite-01/contracts/typechain";

type AlchemyWebhookResponse<T> = T & {
  /**
   * Unique ID of the webhook destination.
   */
  webhookId: string;
  /**
   * ID of the event.
   */
  id: string;
  /**
   * Timestamp when the webhook was created.
   */
  createdAt: string;
};

type AlchemyWebhook_GraphqlResponse = AlchemyWebhookResponse<{
  /**
   * Webhook event type.
   */
  type: "GRAPHQL";
  /**
   * Nested block/transaction/log object.
   */
  event: {
    /**
     * An incrementing integer used for client-side re-org handling.
     */
    sequenceNumber: string;
    data: {
      /**
       * Nested object under each block
       */
      block: {
        logs: Array<{
          transaction: {
            hash: string;
            index: number;
            from: {
              address: string;
            };
            to: {
              address: string;
            };
            maxFeePerGas: string;
            maxPriorityFeePerGas: string;
            gasUsed: number;
            cumulativeGasUsed: number;
            effectiveGasPrice: string;
            logs: Array<{
              index: number;
              topics: string[];
              account: {
                address: string;
              };
            }>;
            type: number;
            status: number;
          };
        }>;
      };
    };
  };
}>;

type AlchemyWebhook_AddressActivityResponse = AlchemyWebhookResponse<{
  /**
   * Webhook event type.
   */
  type: "ADDRESS_ACTIVITY";
  /**
   * Mined transaction object.
   */
  event: {
    /**
     * The default network for the webhook.
     */
    network: string;
    /**
     * List of transfer events whose `from` or `to` address matches the address configured in the webhook.
     */
    activity: Array<{
      /**
       * the block where the transfer occurred (hex string)
       */
      blockNum: string;
      /**
       * transaction hash (hex string)
       */
      hash: string;
      /**
       * Transfer from address.
       */
      fromAddress: string;
      /**
       * Transfer to address.
       */
      toAddress: string;
      /**
       * converted asset transfer value as a number (raw value divided by contract decimal). Omitted if erc721 transfer or contract decimal is not available
       */
      value: Maybe<number>;
      /**
       * Raw erc721 token ID.
       */
      erc721TokenId: Maybe<string>;
      /**
       * A list of objects containing the ERC1155 tokenId (hex string) and value (hex string). Omitted if not an ERC1155 transfer
       */
      erc1155Metadata: Maybe<unknown>;
      /**
       * `ETH` or the token's symbol. Omitted if not defined in the contract and not available from other sources
       */
      asset: Maybe<string>;
      /**
       * The `external`, `internal`, `erc721`, `erc1155`, `erc20`, or `token` category label for the transfer.
       * NOTE: tokenmaps to a transfer of an ERC20 OR ERC721 token
       */
      category:
        | "external"
        | "internal"
        | "erc721"
        | "erc1155"
        | "erc20"
        | "token";
      /**
       * Underlying contract data.
       */
      rawContract: Maybe<{
        /**
         * The raw transfer value.
         */
        rawValue: string;
        /**
         * Contract address.
         */
        address: string;
        /**
         * contract decimal (hex string). Omitted if not defined in the contract and not available from other sources.
         */
        decimals: Maybe<number>;
      }>;
      /**
       * the type of internal transfer (`call`, `staticcall`, `create`, `suicide`) followed by the trace address (ex. call_0_1). Omitted if not internal transfer. (note you can use this as a unique id for internal transfers since they will have the same parent hash)
       */
      typeTraceAddress: Maybe<string>;
      /**
       * Returned log of the `token` transfer event.
       */
      log: {
        /**
         * Log origination address.
         */
        address: string;
        /**
         * Array of zero to four 32 bytes of indexed log arguments.
         */
        topics: Array<string>;
        /**
         * Non-indexed arguments of the log.
         */
        data: string;
        blockNumber: string;
        transactionHash: string;
        transactionIndex: string;
        blockHash: string;
        logIndex: string;
        /**
         * Transaction is in a chain re-org & no longer in the canonical chain.
         * @see https://www.alchemy.com/overviews/what-is-a-reorg
         */
        removed: boolean;
      };
    }>;
  };
}>;

export class Alchemy extends SdkHelper implements BaseSdk, OnchainNotifier {
  getClient = (options: SdkOptions): Http => {
    const alchemyToken = this.requireVar(options, KeyVars.AlchemyToken);

    return new Http("https://dashboard.alchemy.com/api", {
      "X-Alchemy-Token": alchemyToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  };

  getCallbackUrl = () => `${this.BaseUrl}/Callback/${Provider.Alchemy}`;

  buildGraphqlQuery = (contractAddress: string, topics: string[]) => {
    const topicsFilter = topics
      .map((t) => (!t?.trim() ? "[]" : `["${t}"]`))
      .join(", ");

    return `
        {
          block {
            hash
            number
            timestamp
            logs(filter: { addresses: ["${contractAddress}"], topics: [${topicsFilter}] }) {
              index
              topics
              data
              account { address }
              transaction { hash index status }
            }
          }
        }
    `;
  };

  track = async (
    appId: string,
    input: OnchainNotifierTrackInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);
    const network = providerDescriptorOfChain<string>(
      input.caip2Id,
      Provider.Alchemy,
    );

    const response = await client.post<{
      data?: { id: string; signing_key: string; [k: string]: unknown };
    }>("/create-webhook", {
      network,
      webhook_type: "ADDRESS_ACTIVITY",
      webhook_url: this.getCallbackUrl(),
      addresses: [input.filter.address.toLowerCase()],
    });

    const providerId = response.data?.data?.id;
    const signingKey = response.data?.data?.signing_key;

    if (!response.isOk || !providerId || !signingKey)
      throw new SdkRequestError(Provider.Alchemy, "/create-webhook", response);

    const created = await new CallbackRequestService().insertRequest({
      input,
      provider: Provider.Alchemy,
      providerId,
      appId,
      signingKey,
    });

    return { correlationId: created.id };
  };

  trackEvent = async (
    appId: string,
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const signature = this.eventSignatureFromAbi(
      input.filter.contractAbi as Abi,
      input.filter.eventName,
    );

    if (!signature) {
      throw new AppError(
        "Could not decode signature from contract ABI. Is the ABI correct?",
      );
    }

    const topics = [this.eventSignatureToTopic0(signature)].concat(
      input.filter.topics ?? [],
    );

    const client = this.getClient(options);
    const network = providerDescriptorOfChain<string>(
      input.caip2Id,
      Provider.Alchemy,
    );

    const response = await client.post<{
      data?: { id: string; signing_key: string; [k: string]: unknown };
    }>("/create-webhook", {
      network,
      webhook_type: "GRAPHQL",
      webhook_url: this.getCallbackUrl(),
      graphql_query: {
        skip_empty_messages: true,
        query: this.buildGraphqlQuery(
          input.filter.contractAddress.toLowerCase(),
          topics,
        ),
      },
    });

    const providerId = response.data?.data?.id;
    const signingKey = response.data?.data?.signing_key;

    if (!response.isOk || !providerId || !signingKey)
      throw new SdkRequestError(Provider.Alchemy, "/create-webhook", response);

    const created = await new CallbackRequestService().insertRequest({
      input,
      appId,
      provider: Provider.Alchemy,
      providerId,
      signingKey,
    });

    return { correlationId: created.id };
  };

  untrack = async (
    appId: string,
    correlationId: string,
    options: SdkOptions,
  ): Promise<void> => {
    const request = await new CallbackRequestService().getRequestById(
      Provider.Alchemy,
      correlationId,
    );

    if (!request || request.appId !== appId)
      throw new NotFoundError("callbackRequest", correlationId);

    const client = this.getClient(options);
    const response = await client.delete("/delete-webhook", {
      params: {
        webhook_id: request.providerId,
      },
    });

    if (!response.isOk)
      throw new SdkRequestError(Provider.Alchemy, "/delete-webhook", response);
  };

  isValidCallback = async (
    input: OnchainNotifierVerifyCallbackInput,
    _options: SdkOptions,
  ): Promise<boolean> => {
    const signature = get(
      input.headers,
      "x-alchemy-signature",
      null,
    ) as Maybe<string>;

    if (!signature) return false;

    const providerId = get(input.body, "webhookId", null) as string | null;
    if (!providerId)
      throw new AppError('Could not find "webhookId" in request body');

    const request = await new CallbackRequestService().getRequestByProviderId(
      Provider.Alchemy,
      providerId,
    );

    if (!request) throw new NotFoundError("callbackRequest", providerId);
    if (!request.signingKey)
      throw new AppError("Request does not have a signing key set");

    const digest = createHmac("sha256", request.signingKey)
      .update(JSON.stringify(input.body), "utf8")
      .digest("hex");

    return this.safeCompare(signature, digest);
  };

  handleCallback = async (
    payload:
      | AlchemyWebhook_GraphqlResponse
      | AlchemyWebhook_AddressActivityResponse,
  ): Promise<OnchainNotifierCallbackResult | void> => {
    const providerId = payload.webhookId;
    const request = await new CallbackRequestService().getRequestByProviderId(
      Provider.Alchemy,
      providerId,
    );

    if (!request) throw new NotFoundError("callbackRequest", providerId);

    if (payload.type === "ADDRESS_ACTIVITY") {
      const input = request.input as OnchainNotifierTrackInput;
      const targetAddress = input.filter.address;
      const tokenAddress = input.filter.tokenAddress;
      const isNativeIn = this.isZeroAddress(tokenAddress);

      const factory = new KiteFactory__factory().connect(null);

      // call the balance
      // does it match what we are looking for
      // if no...return
      // if yes, call the factory to send the transaction (using the configured gasless bit)
    }

    if (payload.type === "GRAPHQL") {
      const input = request.input as OnchainNotifierTrackEventInput;

      // if refunded - update the state
      // if settled
      // track fees paid
      // track excess returned
      // track recoveries attached to a transfer
    }
  };
}
