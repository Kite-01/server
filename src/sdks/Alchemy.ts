import {
  alchemyWalletTransport,
  createSmartWalletClient,
} from "@alchemy/wallet-apis";
import { type Address, type Hex, type LocalAccount } from "viem";
import { type GasSponsor } from "./interfaces/GasSponsor";
import { getViemChain } from "../shared/chains";
import { KeyVars } from "../shared/constants";
import { common } from "../shared/common";

export class Alchemy implements GasSponsor {
  private getClient = (
    caip2Id: Caip2Id,
    signer: LocalAccount,
    options: SdkOptions,
  ) => {
    return createSmartWalletClient({
      transport: alchemyWalletTransport({
        apiKey: common.requireVar(options, KeyVars.AlchemyApiKey),
      }),
      chain: getViemChain(caip2Id),
      signer,
      paymaster: {
        policyId: common.requireVar(options, KeyVars.AlchemyGasPolicyId),
      },
    });
  };

  submitSponsoredCalls = async (
    input: OnchainActorTransactionInput,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<{ callId: string }> => {
    const client = this.getClient(input.caip2Id, signer, options);
    const call = await client.sendCalls({
      calls: [
        {
          to: input.to as Address,
          data: input.data as Hex | undefined,
          value: input.value,
        },
      ],
    });

    return { callId: call.id };
  };

  getSponsoredCallsStatus = async (
    caip2Id: Caip2Id,
    callId: string,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus> => {
    const client = this.getClient(caip2Id, signer, options);
    const result = await client.getCallsStatus({
      id: callId,
    });

    const transactionHash = result.receipts?.[0]?.transactionHash;
    if (result.status === "success" && transactionHash) {
      return {
        status: "success",
        transactionHash,
      };
    }

    if (result.status === "failure") {
      return {
        status: "failure",
        transactionHash,
      };
    }

    return {
      status: "pending",
    };
  };
}
