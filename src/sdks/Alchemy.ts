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
  sendSponsoredTransaction = async (
    input: OnchainActorTransactionInput,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<string> => {
    const apiKey = common.requireVar(options, KeyVars.AlchemyApiKey);
    const policyId = common.requireVar(options, KeyVars.AlchemyGasPolicyId);
    const client = createSmartWalletClient({
      transport: alchemyWalletTransport({ apiKey }),
      chain: getViemChain(input.caip2Id),
      signer,
      paymaster: { policyId },
    });

    const { id } = await client.sendCalls({
      calls: [
        {
          to: input.to as Address,
          data: input.data as Hex,
          value: input.value,
        },
      ],
    });

    const result = await client.waitForCallsStatus({
      id,
      timeout: 120_000,
    });

    if (result.status !== "success") {
      throw new Error("Alchemy-sponsored transaction did not succeed");
    }

    const transactionHash = result.receipts?.[0]?.transactionHash;
    if (!transactionHash) {
      throw new Error("Alchemy returned no transaction receipt");
    }

    return transactionHash;
  };
}
