import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfiguredChain, address } from "../../test/factories";
import { AppError, NotFoundError } from "../../shared/errors";
import { fakeActor, resetMocks } from "../../test/mocks";
import { PriceFeedService } from "../PriceFeed.service";

const service = new PriceFeedService();
const multicall = vi.fn();
const readContract = vi.fn();

const FEED = address(0xfeed);

const round = (
  overrides: Partial<{
    roundId: bigint;
    answer: bigint;
    updatedAt: bigint;
    answeredInRound: bigint;
  }> = {},
) => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const {
    roundId = 10n,
    answer = 108_000_000n,
    updatedAt = now - 60n,
    answeredInRound = 10n,
  } = overrides;
  return [roundId, answer, 0n, updatedAt, answeredInRound];
};

describe("PriceFeedService", () => {
  let chainId: string;

  beforeEach(async () => {
    resetMocks();
    multicall.mockReset();
    readContract.mockReset();
    fakeActor.publicClient.mockResolvedValue({ multicall, readContract });
    chainId = (await createConfiguredChain()).chain.id;
  });

  describe("createPriceFeed", () => {
    it("reads the pair and decimals from the aggregator", async () => {
      multicall.mockResolvedValue([{ result: "eur / usd" }, { result: 8 }]);

      const feed = await service.createPriceFeed({ chainId, address: FEED });

      expect(feed).toMatchObject({
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        decimals: 8,
        address: FEED,
      });
    });

    it("rejects a chain that does not exist", async () => {
      await expect(
        service.createPriceFeed({
          chainId: crypto.randomUUID(),
          address: FEED,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects an address that is not an aggregator", async () => {
      multicall.mockResolvedValue([
        { result: undefined },
        { result: undefined },
      ]);

      await expect(
        service.createPriceFeed({ chainId, address: FEED }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it.each(["ETH", "ETH / USD / EUR", " / USD"])(
      "rejects the description %j",
      async (description) => {
        multicall.mockResolvedValue([{ result: description }, { result: 8 }]);

        await expect(
          service.createPriceFeed({ chainId, address: FEED }),
        ).rejects.toThrow();
      },
    );

    it("allows one feed per pair", async () => {
      multicall.mockResolvedValue([{ result: "EUR / USD" }, { result: 8 }]);
      await service.createPriceFeed({ chainId, address: FEED });

      await expect(
        service.createPriceFeed({ chainId, address: address(0xfeed2) }),
      ).rejects.toThrow();
    });
  });

  describe("getPrice", () => {
    beforeEach(async () => {
      multicall.mockResolvedValue([{ result: "EUR / USD" }, { result: 8 }]);
      await service.createPriceFeed({ chainId, address: FEED });
    });

    it("returns the latest answer for the pair, ignoring case", async () => {
      readContract.mockResolvedValue(round());

      expect(await service.getPrice("eur", "usd")).toEqual({
        answer: 108_000_000n,
        decimals: 8,
      });
    });

    it("fails for a pair without a feed", async () => {
      await expect(service.getPrice("GBP", "USD")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it.each([
      ["a zero answer", { answer: 0n }],
      ["a negative answer", { answer: -1n }],
      ["a never-updated feed", { updatedAt: 0n }],
      [
        "an update from the future",
        { updatedAt: BigInt(Math.floor(Date.now() / 1000) + 3600) },
      ],
      ["a stale round", { roundId: 10n, answeredInRound: 9n }],
      [
        "a day-old answer",
        { updatedAt: BigInt(Math.floor(Date.now() / 1000) - 86_401) },
      ],
    ])("refuses %s", async (_label, overrides) => {
      readContract.mockResolvedValue(round(overrides));

      await expect(service.getPrice("EUR", "USD")).rejects.toThrow(
        "cannot be priced at the moment",
      );
    });
  });

  it("lists feeds with their chain and deletes them", async () => {
    multicall.mockResolvedValue([{ result: "EUR / USD" }, { result: 8 }]);
    const feed = await service.createPriceFeed({ chainId, address: FEED });

    const all = await service.getPriceFeeds();
    expect(all).toHaveLength(1);
    expect(all[0].chain.caip2Id).toBe("eip155:8453");

    await service.deletePriceFeed(feed.id);
    expect(await service.getPriceFeeds()).toHaveLength(0);
  });

  it("lists each feed with its current rate, or none when it can't be read", async () => {
    multicall.mockResolvedValue([{ result: "EUR / USD" }, { result: 8 }]);
    await service.createPriceFeed({ chainId, address: FEED });

    readContract.mockResolvedValueOnce(round({ answer: 108_123_456n }));
    const [live] = await service.getPriceFeeds();
    expect(live.rate).toBe("1.08123456");
    expect(live.chain).not.toHaveProperty("config");

    readContract.mockResolvedValueOnce(round({ updatedAt: 1n }));
    expect((await service.getPriceFeeds())[0].rate).toBeNull();
  });
});
