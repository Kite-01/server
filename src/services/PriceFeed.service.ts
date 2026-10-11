import { AppError, NotFoundError } from "../shared/errors";
import { ChainLinkAggregatorV3 } from "../shared/abis/ChainLinkAggregatorV3";
import { getOnchainActor } from "../shared/onchainActor";
import { and, eq, desc } from "drizzle-orm";
import { ChainService } from "./Chain.service";
import { type Address } from "viem";
import { priceFeed } from "../db/schema";
import { getChain } from "../shared/chains";
import { OneDay } from "../shared/constants";
import { db } from "../db";

export class PriceFeedService {
  createPriceFeed = async (
    input: Omit<
      typeof priceFeed.$inferInsert,
      "baseCurrency" | "quoteCurrency" | "decimals"
    >,
  ) => {
    const chainService = new ChainService();
    const chain = await chainService.getChainById(input.chainId);
    if (!chain) throw new NotFoundError("chain", input.chainId);

    const onchainActor = getOnchainActor(getChain(chain.caip2Id).type);
    const client = await onchainActor.publicClient(
      chain.caip2Id,
      chain.config?.rpcUrls ?? [],
    );

    const [description_, decimals_] = await client.multicall({
      allowFailure: true,
      contracts: [
        {
          address: input.address as Address,
          abi: ChainLinkAggregatorV3.abi,
          functionName: "description",
        },
        {
          address: input.address as Address,
          abi: ChainLinkAggregatorV3.abi,
          functionName: "decimals",
        },
      ],
    });

    const description = description_.result,
      decimals = decimals_.result;

    if (!description || typeof decimals !== "number") {
      throw new AppError("Could not get meta information from address");
    }

    const [baseCurrency, quoteCurrency, ...rest] = description
      .split("/")
      .map((part) => part.trim().toUpperCase());

    if (!baseCurrency || !quoteCurrency || rest.length) {
      throw new AppError(`Unrecognised price feed description: ${description}`);
    }

    const [row] = await db
      .insert(priceFeed)
      .values({ ...input, decimals, baseCurrency, quoteCurrency })
      .returning();

    return row;
  };

  getPriceFeeds = async () => {
    return db.query.priceFeed.findMany({
      orderBy: desc(priceFeed.createdAt),
      with: { chain: true },
    });
  };

  getPriceFeedsById = async (priceFeedId: string) => {
    return db.query.priceFeed.findMany({
      where: eq(priceFeed.id, priceFeedId),
      with: {
        chain: {
          with: {
            config: true,
          },
        },
      },
    });
  };

  getPrice = async (baseCurrency: string, quoteCurrency: string) => {
    baseCurrency = baseCurrency.toUpperCase();
    quoteCurrency = quoteCurrency.toUpperCase();

    const priceFeed = await this.getPriceFeedByCurrency(
      baseCurrency,
      quoteCurrency,
    );

    if (!priceFeed)
      throw new NotFoundError("priceFeed", `${baseCurrency}/${quoteCurrency}`);

    const onchainActor = getOnchainActor(
      getChain(priceFeed.chain.caip2Id).type,
    );

    const client = await onchainActor.publicClient(
      priceFeed.chain.caip2Id,
      priceFeed.chain?.config?.rpcUrls ?? [],
    );

    const roundData = await client.readContract({
      abi: ChainLinkAggregatorV3.abi,
      address: priceFeed.address as Address,
      functionName: "latestRoundData",
    });

    const [roundId, answer, , updatedAt, answeredInRound] = roundData;
    const now = BigInt(Math.floor(Date.now() / 1000));

    if (
      answer <= 0n ||
      updatedAt <= 0n ||
      updatedAt > now ||
      answeredInRound < roundId ||
      now - updatedAt > BigInt(OneDay)
    ) {
      throw new AppError(
        `${baseCurrency}/${quoteCurrency} cannot be priced at the moment`,
      );
    }

    return {
      answer,
      decimals: priceFeed.decimals,
    };
  };

  getPriceFeedByCurrency = async (
    baseCurrency: string,
    quoteCurrency: string,
  ) => {
    return db.query.priceFeed.findFirst({
      where: and(
        eq(priceFeed.baseCurrency, baseCurrency),
        eq(priceFeed.quoteCurrency, quoteCurrency),
      ),
      with: {
        chain: {
          with: {
            config: true,
          },
        },
      },
    });
  };

  deletePriceFeed = async (priceFeedId: string) => {
    await db.delete(priceFeed).where(eq(priceFeed.id, priceFeedId));
  };
}
