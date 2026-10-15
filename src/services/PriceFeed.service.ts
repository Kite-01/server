import { type Address, formatUnits } from "viem";
import { AppError, NotFoundError } from "../shared/errors";
import { ChainLinkAggregatorV3 } from "../shared/abis/ChainLinkAggregatorV3";
import { getOnchainActor } from "../shared/onchainActor";
import { and, eq, desc } from "drizzle-orm";
import { ChainService } from "./Chain.service";
import { priceFeed } from "../db/schema";
import { getChain } from "../shared/chains";
import { OneDay } from "../shared/constants";
import { omit } from "lodash";
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
    const rows = await db.query.priceFeed.findMany({
      orderBy: desc(priceFeed.createdAt),
      with: { chain: { with: { config: true } } },
    });

    return Promise.all(
      rows.map(async (row) => {
        const answer = await this.readAnswer(row).catch(() => null);

        return {
          ...row,
          chain: omit(row.chain, ["config"]),
          rate: answer === null ? null : formatUnits(answer, row.decimals),
        };
      }),
    );
  };

  getSupportedCurrencies = async () => {
    const rows = await db
      .selectDistinct({ currency: priceFeed.baseCurrency })
      .from(priceFeed)
      .where(eq(priceFeed.quoteCurrency, "USD"));

    return [
      "USD",
      ...rows
        .map((row) => row.currency)
        .filter((currency) => currency !== "USD")
        .sort(),
    ];
  };

  isSupportedCurrency = async (currency: string) => {
    currency = currency.toUpperCase();
    if (currency === "USD") {
      return true;
    }

    return !!(await this.getPriceFeedByCurrency(currency, "USD"));
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

    return {
      answer: await this.readAnswer(priceFeed),
      decimals: priceFeed.decimals,
    };
  };

  private readAnswer = async (
    feed: Pick<
      typeof priceFeed.$inferSelect,
      "address" | "baseCurrency" | "quoteCurrency"
    > & {
      chain: { caip2Id: Caip2Id; config: { rpcUrls: string[] | null } | null };
    },
  ) => {
    const onchainActor = getOnchainActor(getChain(feed.chain.caip2Id).type);
    const client = await onchainActor.publicClient(
      feed.chain.caip2Id,
      feed.chain.config?.rpcUrls ?? [],
    );

    const roundData = await client.readContract({
      abi: ChainLinkAggregatorV3.abi,
      address: feed.address as Address,
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
        `${feed.baseCurrency}/${feed.quoteCurrency} cannot be priced at the moment`,
      );
    }

    return answer;
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
