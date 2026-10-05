import { isProviderConfiguredForAction } from "../shared/providers";
import { Address, keccak256, toHex } from "viem";
import { AppError, NotFoundError } from "../shared/errors";
import { and, eq, isNull, desc } from "drizzle-orm";
import { KiteFactory__factory } from "@kite-01/contracts/typechain/factories/contracts/KiteFactory__factory";
import { chain, chainConfig } from "../db/schema";
import { getOnchainActor } from "../shared/onchainActor";
import { ProviderAction } from "../shared/constants";
import { type KvService } from "./Kv.service";
import { getChain } from "../shared/chains";
import { omit } from "lodash";
import { db } from "../db";

export class ChainService {
  constructor(private readonly kvService: KvService) {}

  createChain = async (input: typeof chain.$inferInsert) => {
    const [row] = await db.insert(chain).values(input).returning();
    return row;
  };

  getChains = async () => {
    return await db.query.chain.findMany({
      where: isNull(chain.deletedAt),
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
      where: and(eq(chain.isActive, true), isNull(chain.deletedAt)),
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

    try {
      const operatorAddress = onchainActor.getAddress();
      const hasRole = await client.readContract({
        abi: KiteFactory__factory.abi,
        address: input.kiteFactoryAddress as Address,
        functionName: "hasRole",
        args: [keccak256(toHex("OPERATOR_ROLE")), operatorAddress as Address],
      });

      if (!hasRole) {
        throw new AppError(
          "Server wallet is not a configured operator on provided KiteFactory",
        );
      }
    } catch {
      throw new AppError("Is this a valid KiteFactory contract?");
    }

    const variables = await this.kvService.getSdkOptionVariables();

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

    await db
      .insert(chainConfig)
      .values({ ...input, chainId })
      .onConflictDoUpdate({
        target: chainConfig.chainId,
        set: { ...omit(input, ["chainId"]), updatedAt: new Date() },
      });
  };

  deleteChain = async (chainId: string) => {
    await db
      .update(chain)
      .set({ deletedAt: new Date() })
      .where(and(eq(chain.id, chainId), isNull(chain.deletedAt)));
  };
}
