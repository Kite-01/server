import { KeyVars, Provider } from "../shared/constants";
import { SdkRequestError } from "../shared/errors";
import { getChain } from "../shared/chains";
import { BaseSdk } from "./interfaces/BaseSdk";
import { common } from "../shared/common";
import { Http } from "./Http";

export type NearIntentsToken = {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  contractAddress?: string | null;
};

export type NearIntentsQuoteRequest = {
  dry: boolean;
  swapType: "FLEX_INPUT" | "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
};

export type NearIntentsQuote = {
  correlationId?: string;
  signature?: string;
  quote: {
    depositAddress?: string;
    amountIn: string;
    minAmountIn: string;
    amountOut: string;
    minAmountOut: string;
    deadline?: string;
  };
};

export type NearIntentsStatus = {
  status:
    | "KNOWN_DEPOSIT_TX"
    | "PENDING_DEPOSIT"
    | "INCOMPLETE_DEPOSIT"
    | "PROCESSING"
    | "SUCCESS"
    | "REFUNDED"
    | "FAILED";
  swapDetails?: {
    amountOut?: string;
    amountOutFormatted?: string;
    refundedAmount?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
    destinationChainTxHashes?: Array<{
      hash: string;
      explorerUrl?: string;
    }>;
  };
};

export class NearIntents implements BaseSdk {
  private failure = (url: string, response: HttpResponse) => {
    const message = (response.data as { message?: unknown } | undefined)
      ?.message;

    return new SdkRequestError(
      Provider.NearIntents,
      url,
      response,
      typeof message === "string" ? message : undefined,
    );
  };

  getClient = (options: SdkOptions) => {
    const apiKey = common.getVar(options, KeyVars.NearIntentsApiKey);

    return new Http("https://1click.chaindefuser.com/v0", {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    });
  };

  getTokens = async (options: SdkOptions) => {
    const url = "/tokens";
    const response = await this.getClient(options).get<NearIntentsToken[]>(url);
    if (!response.isOk || !Array.isArray(response.data)) {
      throw this.failure(url, response);
    }

    return response.data;
  };

  getAssetId = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    options: SdkOptions,
  ) => {
    const blockchain = getChain(caip2Id).descriptors?.[Provider.NearIntents];
    if (typeof blockchain !== "string" || common.isZeroAddress(tokenAddress)) {
      return null;
    }

    const tokens = await this.getTokens(options);
    const match = tokens.find(
      (item) =>
        item.blockchain === blockchain &&
        common.isSameAddress(item.contractAddress, tokenAddress),
    );

    return match?.assetId ?? null;
  };

  quote = async (input: NearIntentsQuoteRequest, options: SdkOptions) => {
    const url = "/quote";
    const response = await this.getClient(options).post<NearIntentsQuote>(
      url,
      input,
    );

    if (!response.isOk || !response.data?.quote) {
      throw this.failure(url, response);
    }

    return response.data;
  };

  getStatus = async (depositAddress: string, options: SdkOptions) => {
    const url = `/status?depositAddress=${encodeURIComponent(depositAddress)}`;
    const response = await this.getClient(options).get<NearIntentsStatus>(url);
    if (!response.isOk || !response.data?.status) {
      throw this.failure(url, response);
    }

    return response.data;
  };
}
