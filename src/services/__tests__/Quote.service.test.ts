import {
  createApp,
  createChain,
  createConfiguredChain,
  createCustomer,
  createFee,
  createPaymentLink,
  createToken,
  address,
  USDC,
  WETH,
} from "../../test/factories";
import {
  fakeActor,
  operatorAddress,
  resetMocks,
  stubQuoter,
} from "../../test/mocks";
import { FeeType, KiteMaxFees, QuoteTTLSeconds } from "../../shared/constants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, NotFoundError } from "../../shared/errors";
import { chainConfig, quoteFee } from "../../db/schema";
import { PriceFeedService } from "../PriceFeed.service";
import { QuoteService } from "../Quote.service";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const service = new QuoteService();

describe("QuoteService", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;
  let weth: Awaited<ReturnType<typeof createToken>>;

  beforeEach(async () => {
    resetMocks();
    appId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    usdcId = configured.usdc.id;
    weth = await createToken(chainId, {
      address: WETH,
      symbol: "WETH",
      decimals: 18,
    });
  });

  describe("createQuote", () => {
    it("quotes a settlement-token payment one to one", async () => {
      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: USDC,
        amount: 25_000_000n,
        reference: "order-1",
        meta: { sku: "a" },
      });

      expect(quote).toMatchObject({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
        sourceAmount: 25_000_000n,
        targetAmount: 25_000_000n,
        sourceUsdAmount: "25.000000000000000000",
        targetUsdAmount: "25.000000000000000000",
        rate: "1.000000000000000000",
        uniswapPoolFeeTier: null,
        reference: "order-1",
        meta: { sku: "a" },
      });

      const ttl = quote.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan((QuoteTTLSeconds - 5) * 1000);
      expect(ttl).toBeLessThanOrEqual(QuoteTTLSeconds * 1000);
    });

    it("swaps through the best Uniswap fee tier", async () => {
      stubQuoter({
        exactIn: ({ fee, tokenIn, tokenOut }) => {
          expect(tokenIn).toBe(WETH);
          expect(tokenOut).toBe(USDC);
          return (
            { 500: 3_100_000n, 3000: 3_000_000n, 10000: 2_900_000n }[fee] ??
            null
          );
        },
      });

      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: WETH,
        amount: 10n ** 15n,
      });

      expect(quote).toMatchObject({
        sourceTokenId: weth.id,
        targetTokenId: usdcId,
        sourceAmount: 10n ** 15n,
        targetAmount: 3_100_000n,
        uniswapPoolFeeTier: 500,
        sourceUsdAmount: "3.100000000000000000",
        targetUsdAmount: "3.100000000000000000",
        rate: "3100.000000000000000000",
      });
    });

    it("prices a non-USD settlement through the USD token", async () => {
      const dai = await createToken(chainId, {
        symbol: "DAI",
        decimals: 18,
        address: address(0xda1),
      });
      await db
        .update(chainConfig)
        .set({ settlementTokenId: dai.id })
        .where(eq(chainConfig.chainId, chainId));

      stubQuoter({
        exactIn: ({ tokenOut, fee }) => {
          if (fee !== 500) return null;
          return tokenOut === dai.address ? 2n * 10n ** 18n : 1_990_000n;
        },
      });

      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: WETH,
        amount: 10n ** 15n,
      });

      expect(quote).toMatchObject({
        targetTokenId: dai.id,
        targetAmount: 2n * 10n ** 18n,
        sourceUsdAmount: "1.990000000000000000",
        targetUsdAmount: "1.990000000000000000",
      });
    });

    it("fails when no pool can fill the swap", async () => {
      stubQuoter({ exactIn: () => null });

      await expect(
        service.createQuote(appId, {
          chainId,
          sourceTokenAddress: WETH,
          amount: 10n ** 15n,
        }),
      ).rejects.toThrow("No pool can swap this token/amount");
    });

    it("rejects non-positive amounts", async () => {
      await expect(
        service.createQuote(appId, {
          chainId,
          sourceTokenAddress: USDC,
          amount: 0n,
        }),
      ).rejects.toThrow("Amount must be greater than zero");
    });

    it("needs a configured chain", async () => {
      const bare = await createChain("eip155:10");

      await expect(
        service.createQuote(appId, {
          chainId: bare.id,
          sourceTokenAddress: USDC,
          amount: 1n,
        }),
      ).rejects.toThrow("yet to be configured");
      await expect(
        service.createQuote(appId, {
          chainId: crypto.randomUUID(),
          sourceTokenAddress: USDC,
          amount: 1n,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("enforces one reference per app", async () => {
      const input = {
        chainId,
        sourceTokenAddress: USDC,
        amount: 1_000_000n,
        reference: "r-1",
      };
      await service.createQuote(appId, input);

      await expect(service.createQuote(appId, input)).rejects.toThrow();
      const other = await createApp();
      await expect(service.createQuote(other.id, input)).resolves.toBeDefined();
    });

    it("attaches the customer, and refuses a customer from another app", async () => {
      const customer = await createCustomer(appId);
      const otherCustomer = await createCustomer((await createApp()).id);

      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: USDC,
        amount: 1_000_000n,
        customerId: customer.id,
      });
      expect(quote.customerId).toBe(customer.id);

      await expect(
        service.createQuote(appId, {
          chainId,
          sourceTokenAddress: USDC,
          amount: 1_000_000n,
          customerId: otherCustomer.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    describe("fees", () => {
      const quoteWith = (amount = 1_000_000n) =>
        service.createQuote(appId, {
          chainId,
          sourceTokenAddress: USDC,
          amount,
        });

      it("charges matching fees from the target amount and records them", async () => {
        await createFee(chainId, {
          appId,
          label: "platform",
          type: FeeType.Variable,
          value: 30n,
        });
        await createFee(chainId, {
          appId: null,
          label: "network",
          type: FeeType.Fixed,
          value: 500n,
        });
        await createFee(chainId, { appId, label: "other chain", value: 99n });
        await createFee(chainId, {
          appId,
          label: "large only",
          value: 7n,
          condition: { sourceAmount: { _gte: "5000000" } },
        });

        const quote = await quoteWith();
        const rows = await db.select().from(quoteFee);

        expect(rows.map((r) => [r.label, r.amount]).sort()).toEqual(
          [
            ["network", 500n],
            ["platform", 3000n],
            ["other chain", 99n],
          ].sort(),
        );
        expect(rows.every((r) => r.quoteId === quote.id)).toBe(true);
        expect(rows.every((r) => r.feeAddress === operatorAddress)).toBe(true);
      });

      it("sends fees to the fee address, then the settlement address, then the operator", async () => {
        const feeAddress = address(0xfee1);
        const settlement = address(0x5e77);
        await db
          .update(chainConfig)
          .set({ settlementAddress: settlement })
          .where(eq(chainConfig.chainId, chainId));

        await createFee(chainId, {
          appId,
          label: "explicit",
          value: 1n,
          feeAddress,
        });
        await createFee(chainId, { appId, label: "default", value: 2n });

        await quoteWith();
        const rows = await db.select().from(quoteFee);
        const byLabel = Object.fromEntries(
          rows.map((r) => [r.label, r.feeAddress]),
        );

        expect(byLabel).toEqual({ explicit: feeAddress, default: settlement });
      });

      it("skips fees that come to nothing", async () => {
        await createFee(chainId, { appId, label: "zero", value: 0n });

        await quoteWith();
        expect(await db.select().from(quoteFee)).toHaveLength(0);
      });

      it("applies fee limits", async () => {
        await createFee(chainId, {
          appId,
          label: "capped",
          type: FeeType.Variable,
          value: 100n,
          minAmountToCharge: 20_000n,
          maxAmountToCharge: 50_000n,
        });

        await quoteWith(10_000_000n);
        const [row] = await db.select().from(quoteFee);
        expect(row.amount).toBe(50_000n);
      });

      it("matches customer-specific fees on traits", async () => {
        const pro = await createCustomer(appId, { traits: { plan: "pro" } });
        const free = await createCustomer(appId, { traits: { plan: "free" } });
        await createFee(chainId, {
          appId,
          label: "pro discount",
          value: 111n,
          condition: { customer: { "traits.plan": { _eq: "pro" } } },
        });

        const quoteFor = (customerId: string) =>
          service.createQuote(appId, {
            chainId,
            sourceTokenAddress: USDC,
            amount: 1_000_000n,
            customerId,
          });

        await quoteFor(free.id);
        expect(await db.select().from(quoteFee)).toHaveLength(0);

        await quoteFor(pro.id);
        expect(await db.select().from(quoteFee)).toHaveLength(1);
      });

      it("refuses fees that exceed what the payment settles for", async () => {
        await createFee(chainId, { appId, value: 995_000n });

        await expect(quoteWith()).rejects.toThrow("Fees exceed the amount");
      });

      it("refuses more fees than the contract allows", async () => {
        for (let i = 0; i <= KiteMaxFees; i++) {
          await createFee(chainId, { appId, label: `f${i}`, value: 1n });
        }

        await expect(quoteWith()).rejects.toThrow("Too many fees");
      });

      it("does not leave a quote behind when the fees are refused", async () => {
        await createFee(chainId, { appId, value: 995_000n });
        await quoteWith().catch(() => undefined);

        expect((await service.getQuotes({ appId })).total).toBe(0);
      });
    });
  });

  describe("createQuoteFromPaymentLink", () => {
    it("prices a USD link in the USD token", async () => {
      const link = await createPaymentLink(appId, {
        amount: "10",
        currency: "usd",
      });

      const quote = await service.createQuoteFromPaymentLink(appId, link.id, {
        chainId,
        sourceTokenAddress: USDC,
      });

      expect(quote).toMatchObject({
        paymentLinkId: link.id,
        sourceAmount: 10_000_000n,
        targetAmount: 10_000_000n,
        targetUsdAmount: "10.000000000000000000",
        uniswapPoolFeeTier: null,
      });
    });

    it("asks for the cheapest input when paying with another token", async () => {
      const link = await createPaymentLink(appId, { amount: "10" });
      stubQuoter({
        exactOut: ({ fee, tokenIn, tokenOut, amount }) => {
          expect(tokenIn).toBe(WETH);
          expect(tokenOut).toBe(USDC);
          expect(amount).toBe(10_000_000n);
          return (
            {
              500: 4n * 10n ** 15n,
              3000: 3n * 10n ** 15n,
              10000: 5n * 10n ** 15n,
            }[fee] ?? null
          );
        },
      });

      const quote = await service.createQuoteFromPaymentLink(appId, link.id, {
        chainId,
        sourceTokenAddress: WETH,
      });

      expect(quote).toMatchObject({
        sourceTokenId: weth.id,
        sourceAmount: 3n * 10n ** 15n,
        targetAmount: 10_000_000n,
        uniswapPoolFeeTier: 3000,
      });
    });

    it("converts other currencies with the price feed", async () => {
      const link = await createPaymentLink(appId, {
        amount: "10",
        currency: "EUR",
      });
      const multicall = vi
        .fn()
        .mockResolvedValue([{ result: "EUR / USD" }, { result: 8 }]);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const readContract = vi
        .fn()
        .mockResolvedValue([5n, 108_000_000n, 0n, now, 5n]);
      fakeActor.publicClient.mockResolvedValue({ multicall, readContract });
      await new PriceFeedService().createPriceFeed({
        chainId,
        address: address(0xfeed),
      });

      const quote = await service.createQuoteFromPaymentLink(appId, link.id, {
        chainId,
        sourceTokenAddress: USDC,
      });

      expect(quote.targetAmount).toBe(10_800_000n);
      expect(quote.targetUsdAmount).toBe("10.800000000000000000");
    });

    it("does not quote another app's link", async () => {
      const other = await createApp();
      const link = await createPaymentLink(other.id);

      await expect(
        service.createQuoteFromPaymentLink(appId, link.id, {
          chainId,
          sourceTokenAddress: USDC,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("fails when nothing can fill the payment", async () => {
      const link = await createPaymentLink(appId);
      stubQuoter({ exactOut: () => null });

      await expect(
        service.createQuoteFromPaymentLink(appId, link.id, {
          chainId,
          sourceTokenAddress: WETH,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe("reads", () => {
    it("keeps quotes inside their app and loads relations", async () => {
      const other = await createApp();
      const mine = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: USDC,
        amount: 1_000_000n,
      });
      await service.createQuote(other.id, {
        chainId,
        sourceTokenAddress: USDC,
        amount: 1_000_000n,
      });

      const found = await service.getQuote(appId, mine.id);
      expect(found?.sourceToken.symbol).toBe("USDC");
      expect(found?.chain.caip2Id).toBe("eip155:8453");
      expect(await service.getQuote(other.id, mine.id)).toBeUndefined();

      expect(
        (await service.getQuotes({ appId })).data.map((q) => q.id),
      ).toEqual([mine.id]);
      expect((await service.getQuotes({})).total).toBe(2);
    });

    it("searches quotes by id or reference", async () => {
      const input = { chainId, sourceTokenAddress: USDC, amount: 1_000_000n };
      const a = await service.createQuote(appId, {
        ...input,
        reference: "invoice-9",
      });
      await service.createQuote(appId, { ...input, reference: "invoice-10" });

      const ids = async (q: string) =>
        (await service.getQuotes({ appId, q })).data.map((quote) => quote.id);

      expect(await ids("invoice-9")).toEqual([a.id]);
      expect(await ids(a.id.slice(0, 8))).toEqual([a.id]);
      expect((await ids("invoice")).length).toBe(2);
    });

    it("records a fee receipt once", async () => {
      await createFee(chainId, { appId, value: 10n });
      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: USDC,
        amount: 1_000_000n,
      });
      const [row] = await db.select().from(quoteFee);

      await service.addQuoteFeeReceipt(row.id, "0xfirst");
      await service.addQuoteFeeReceipt(row.id, "0xsecond");

      const stored = await service.getQuote(appId, quote.id);
      expect(stored?.fees[0].blockchainHash).toBe("0xfirst");
    });
  });
});
