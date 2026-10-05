import { AppError, NotFoundError } from "../shared/errors";
import { ChainLinkAggregatorV3 } from "../shared/abis/ChainLinkAggregatorV3";
import { type ChainService } from "./Chain.service";
import { getOnchainActor } from "../shared/onchainActor";
import { and, eq, desc } from "drizzle-orm";
import { type Address } from "viem";
import { priceFeed } from "../db/schema";
import { getChain } from "../shared/chains";
import { db } from "../db";

export class PriceFeedService {
  constructor(private readonly chainService: ChainService) {}

  createPriceFeed = async (
    input: Omit<
      typeof priceFeed.$inferInsert,
      "baseCurrency" | "quoteCurrency" | "decimals"
    >,
  ) => {
    const chain = await this.chainService.getChainById(input.chainId);
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

    if (!description || !decimals)
      throw new AppError("Could not get meta information from address");

    const [baseCurrency, quoteCurrency] = description.split("/");
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

    const answer = Number(roundData[1]);
    return answer / 10 ** priceFeed.decimals;
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
