import { type Address, isAddress, keccak256, toHex } from "viem";
import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { isProviderConfiguredForAction } from "../shared/providers";
import { getChain, getSupportedChains } from "../shared/chains";
import { AppError, NotFoundError } from "../shared/errors";
import { KiteFactory__factory } from "@kite-01/contracts/typechain/factories/contracts/KiteFactory__factory.js";
import { chain, chainConfig } from "../db/schema";
import { getOnchainActor } from "../shared/onchainActor";
import { ProviderAction } from "../shared/constants";
import { KvService } from "./Kv.service";
import { common } from "../shared/common";
import { omit } from "lodash";
import { db } from "../db";

const supportedCaip2Ids = () => {
  return inArray(
    chain.caip2Id,
    getSupportedChains().map((item) => item.caip2Id),
  );
};

export class ChainService {
  createChain = async (input: typeof chain.$inferInsert) => {
    getChain(input.caip2Id); // to be sure chain is supported

    const [row] = await db.insert(chain).values(input).returning();
    return row;
  };

  updateChainActiveStatus = async (chainId: string, isActive: boolean) => {
    const [row] = await db
      .update(chain)
      .set({ isActive })
      .where(and(eq(chain.id, chainId), isNull(chain.deletedAt)))
      .returning();

    return row;
  };

  getChains = async () => {
    return await db.query.chain.findMany({
      where: and(isNull(chain.deletedAt), supportedCaip2Ids()),
      orderBy: desc(chain.createdAt),
      with: {
        config: {
          with: {
            settlementToken: true,
            usdPeggedToken: true,
          },
        },
      },
    });
  };

  getActiveChains = async () => {
    return await db.query.chain.findMany({
      where: and(
        eq(chain.isActive, true),
        isNull(chain.deletedAt),
        supportedCaip2Ids(),
      ),
      orderBy: desc(chain.createdAt),
      with: {
        config: {
          with: {
            settlementToken: true,
            usdPeggedToken: true,
          },
        },
      },
    });
  };

  getChainById = async (chainId: string) => {
    return await db.query.chain.findFirst({
      where: and(eq(chain.id, chainId), isNull(chain.deletedAt)),
      with: {
        config: {
          with: {
            settlementToken: true,
            usdPeggedToken: true,
          },
        },
      },
    });
  };

  getChainByCaip2Id = async (caip2Id: Caip2Id) => {
    return await db.query.chain.findFirst({
      where: and(eq(chain.caip2Id, caip2Id), isNull(chain.deletedAt)),
      with: {
        config: {
          with: {
            settlementToken: true,
            usdPeggedToken: true,
          },
        },
      },
    });
  };

  upsertChainConfig = async (
    chainId: string,
    input: Omit<typeof chainConfig.$inferInsert, "chainId">,
  ) => {
    const chain = await this.getChainById(chainId);
    if (!chain) throw new NotFoundError("chain", chainId);

    if (input.slippageBps < 0 || input.slippageBps > 9900) {
      throw new AppError("Slippage must be between 0 and 9900 Bps");
    }

    const internalChain = getChain(chain.caip2Id);
    const onchainActor = getOnchainActor(internalChain.type);
    const client = await onchainActor.publicClient(
      chain.caip2Id,
      input.rpcUrls ?? [],
    );

    if (!isAddress(input.kiteFactoryAddress)) {
      throw new AppError("The KiteFactory address is not a valid address");
    }

    const operatorAddress = onchainActor.getAddress();
    const hasRole = await client
      .readContract({
        abi: KiteFactory__factory.abi,
        address: common.normalizeAddress(input.kiteFactoryAddress),
        functionName: "hasRole",
        args: [keccak256(toHex("OPERATOR_ROLE")), operatorAddress as Address],
      })
      .catch(() => {
        throw new AppError("Is this a valid KiteFactory contract?");
      });

    if (!hasRole) {
      throw new AppError(
        "Server wallet is not a configured operator on provided KiteFactory",
      );
    }

    const variables = await new KvService().getSdkOptionVariables();

    input.onchainNotifierProviders.map((provider) =>
      isProviderConfiguredForAction(provider, ProviderAction.OnchainNotifier, {
        variables,
      }),
    );

    input.gasSponsorProviders.map((provider) =>
      isProviderConfiguredForAction(provider, ProviderAction.GasSponsor, {
        variables,
      }),
    );

    for (const provider of input.gasSponsorProviders) {
      const reason = await onchainActor.getSponsorshipError(
        chain.caip2Id,
        provider,
        { variables },
      );

      if (reason) {
        throw new AppError(
          `${provider} cannot sponsor gas on ${internalChain.name}: ${reason}`,
        );
      }
    }

    const values = {
      ...input,
      kiteFactoryAddress: common.normalizeAddress(input.kiteFactoryAddress),
    };

    await db
      .insert(chainConfig)
      .values({ ...values, chainId })
      .onConflictDoUpdate({
        target: chainConfig.chainId,
        set: { ...omit(values, ["chainId"]), updatedAt: new Date() },
      });
  };

  deleteChain = async (chainId: string) => {
    const [row] = await db
      .update(chain)
      .set({ deletedAt: new Date() })
      .where(and(eq(chain.id, chainId), isNull(chain.deletedAt)))
      .returning();

    return row;
  };
}
