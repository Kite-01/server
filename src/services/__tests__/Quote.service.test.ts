import {
  acceptChain,
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
  stubPools,
  stubV2Pairs,
} from "../../test/mocks";
import { FeeType, KiteMaxFees, QuoteTTLSeconds } from "../../shared/constants";
import { quoteAtTick, v2AmountIn, v2AmountOut } from "../../sdks/Uniswap";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appChain, chainConfig, quoteFee } from "../../db/schema";
import { AppError, NotFoundError } from "../../shared/errors";
import { PriceFeedService } from "../PriceFeed.service";
import { QuoteService } from "../Quote.service";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const service = new QuoteService();

const WethUsdcTick = -195929;
const WethDaiTick = 76012;

const lessFee = (amount: bigint, fee: number) =>
  (amount * (1_000_000n - BigInt(fee))) / 1_000_000n;

const appAddressOnChain = (appId: string, address_: string) =>
  db
    .update(appChain)
    .set({ address: address_ })
    .where(eq(appChain.appId, appId));

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
    await acceptChain(appId, chainId);
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

    it("swaps at the TWAP of the deepest pool", async () => {
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: WethUsdcTick, liquidity: 5n },
        { tokens: [WETH, USDC], fee: 3000, tick: -195000, liquidity: 1n },
      ]);

      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: WETH,
        amount: 10n ** 15n,
      });

      const targetAmount = quoteAtTick(
        WethUsdcTick,
        lessFee(10n ** 15n, 500),
        WETH,
        USDC,
      );

      expect(Number(targetAmount)).toBeCloseTo(3_098_450, -3);
      expect(quote).toMatchObject({
        sourceTokenId: weth.id,
        targetTokenId: usdcId,
        sourceAmount: 10n ** 15n,
        targetAmount,
        uniswapPoolFeeTier: 500,
      });

      expect(Number(quote.sourceUsdAmount)).toBeCloseTo(3.098, 2);
      expect(quote.sourceUsdAmount).toBe(quote.targetUsdAmount);
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

      stubPools([
        { tokens: [WETH, dai.address], fee: 3000, tick: WethDaiTick },
        { tokens: [WETH, USDC], fee: 500, tick: WethUsdcTick },
      ]);

      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: WETH,
        amount: 10n ** 15n,
      });

      const usd = quoteAtTick(
        WethUsdcTick,
        lessFee(10n ** 15n, 500),
        WETH,
        USDC,
      );

      expect(quote).toMatchObject({
        targetTokenId: dai.id,
        targetAmount: quoteAtTick(
          WethDaiTick,
          lessFee(10n ** 15n, 3000),
          WETH,
          dai.address,
        ),
        uniswapPoolFeeTier: 3000,
      });
      expect(Number(quote.sourceUsdAmount)).toBeCloseTo(Number(usd) / 1e6, 6);
      expect(quote.targetUsdAmount).toBe(quote.sourceUsdAmount);
    });

    it("falls back to a shorter TWAP window for pools with little history", async () => {
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: WethUsdcTick, history: 300 },
      ]);

      const quote = await service.createQuote(appId, {
        chainId,
        sourceTokenAddress: WETH,
        amount: 10n ** 15n,
      });

      expect(quote.uniswapPoolFeeTier).toBe(500);
      expect(fakeActor.ethCall).toHaveBeenCalled();
    });

    it("does not price from a pool without enough history for a TWAP", async () => {
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: WethUsdcTick, history: 30 },
      ]);

      await expect(
        service.createQuote(appId, {
          chainId,
          sourceTokenAddress: WETH,
          amount: 10n ** 15n,
        }),
      ).rejects.toThrow("No pool can swap this token/amount");
    });

    it("does not price from a pool without liquidity", async () => {
      stubPools([
        {
          tokens: [WETH, USDC],
          fee: 500,
          tick: WethUsdcTick,
          liquidity: 0n,
        },
      ]);

      await expect(
        service.createQuote(appId, {
          chainId,
          sourceTokenAddress: WETH,
          amount: 10n ** 15n,
        }),
      ).rejects.toThrow("No pool can swap this token/amount");
    });

    it("fails when no pool can fill the swap", async () => {
      stubPools([]);

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

    it("refuses a chain the app doesn't take payments on", async () => {
      const optimism = await createConfiguredChain("eip155:10");

      await expect(
        service.createQuote(appId, {
          chainId: optimism.chain.id,
          sourceTokenAddress: USDC,
          amount: 1_000_000n,
        }),
      ).rejects.toThrow("App doesn't accept payments on OP Mainnet");
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
      await acceptChain(other.id, chainId);
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

      it("sends fees to the fee address, else app fees to the app's address on the chain and system fees to the operator", async () => {
        const feeAddress = address(0xfee1);
        const settlement = address(0x5e77);
        await appAddressOnChain(appId, settlement);

        await createFee(chainId, {
          appId,
          label: "explicit",
          value: 1n,
          feeAddress,
        });
        await createFee(chainId, { appId, label: "default", value: 2n });
        await createFee(chainId, { appId: null, label: "system", value: 3n });

        await quoteWith();
        const rows = await db.select().from(quoteFee);
        const byLabel = Object.fromEntries(
          rows.map((r) => [r.label, r.feeAddress]),
        );

        expect(byLabel).toEqual({
          explicit: feeAddress,
          default: settlement,
          system: operatorAddress,
        });
      });

      it("sends an app's fees to its own address on the chain, not another app's", async () => {
        const other = await createApp();
        await acceptChain(other.id, chainId, address(0x07e4));
        await appAddressOnChain(appId, address(0x5e77));
        await createFee(chainId, { appId, label: "mine", value: 2n });
        await createFee(chainId, {
          appId: other.id,
          label: "theirs",
          value: 2n,
        });

        await quoteWith();
        const rows = await db.select().from(quoteFee);

        expect(rows.map((r) => [r.label, r.feeAddress])).toEqual([
          ["mine", address(0x5e77)],
        ]);
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
    it("sends the app's fees to its address on the chain", async () => {
      await appAddressOnChain(appId, address(0x5e77));
      await createFee(chainId, { appId, label: "default", value: 2n });
      const link = await createPaymentLink(appId, { amount: "10" });

      await service.createQuoteFromPaymentLink(appId, link.id, {
        chainId,
        sourceTokenAddress: USDC,
      });

      const [row] = await db.select().from(quoteFee);
      expect(row.feeAddress).toBe(address(0x5e77));
    });

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

    it("asks for the TWAP input of the deepest pool when paying with another token", async () => {
      const link = await createPaymentLink(appId, { amount: "10" });
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: -195000, liquidity: 1n },
        { tokens: [WETH, USDC], fee: 3000, tick: WethUsdcTick, liquidity: 3n },
      ]);

      const quote = await service.createQuoteFromPaymentLink(appId, link.id, {
        chainId,
        sourceTokenAddress: WETH,
      });

      const atTwap = quoteAtTick(WethUsdcTick, 10_000_000n, USDC, WETH, true);
      const sourceAmount = (atTwap * 1_000_000n + 996_999n) / 997_000n;

      expect(Number(sourceAmount) / 1e18).toBeCloseTo(10 / 3100 / 0.997, 6);
      expect(quote).toMatchObject({
        sourceTokenId: weth.id,
        sourceAmount,
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

      stubPools([]);

      await expect(
        service.createQuoteFromPaymentLink(appId, link.id, {
          chainId,
          sourceTokenAddress: WETH,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe("Uniswap V2 fallback", () => {
    const WethReserve = 100n * 10n ** 18n;
    const UsdcReserve = 300_000n * 10n ** 6n;
    const steady = [
      {
        fromBlock: 0n,
        amounts: [WethReserve, UsdcReserve] as [bigint, bigint],
      },
    ];

    const quoteOneWeth = () => {
      return service.createQuote(appId, {
        chainId,
        sourceTokenAddress: WETH,
        amount: 10n ** 18n,
      });
    };

    it("swaps through a V2 pair when no V3 pool exists", async () => {
      stubV2Pairs([
        {
          tokens: [WETH, USDC],
          reserves: steady,
        },
      ]);

      expect(await quoteOneWeth()).toMatchObject({
        targetAmount: v2AmountOut(10n ** 18n, WethReserve, UsdcReserve),
        uniswapPoolFeeTier: 0,
      });
    });

    it("doesn't let a pair moved moments ago set the price", async () => {
      stubV2Pairs([
        {
          tokens: [WETH, USDC],
          reserves: [
            ...steady,
            {
              fromBlock: 9_999n,
              amounts: [50n * 10n ** 18n, 600_000n * 10n ** 6n],
            },
          ],
        },
      ]);

      const quote = await quoteOneWeth();

      // 598s at 3,000 and the last 2s at 12,000 average to 3,030, less the 0.3% fee
      expect(Number(quote.targetAmount) / 1e6).toBeCloseTo(3_030 * 0.997, 1);
      expect(quote.uniswapPoolFeeTier).toBe(0);
    });

    it("averages over a shorter window when the RPC can't reach back ten minutes", async () => {
      stubV2Pairs([{ tokens: [WETH, USDC], reserves: steady }], {
        oldestBlock: 9_800n,
      });

      const quote = await quoteOneWeth();

      expect(quote.targetAmount).toBe(
        v2AmountOut(10n ** 18n, WethReserve, UsdcReserve),
      );
      expect(fakeActor.ethCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        9_850n,
      );
    });

    it("won't price a pair whose history the RPC can't read", async () => {
      stubV2Pairs([{ tokens: [WETH, USDC], reserves: steady }], {
        oldestBlock: 10_000n,
      });

      await expect(quoteOneWeth()).rejects.toThrow(
        "No pool can swap this token/amount at the moment",
      );
    });

    it("asks a payment link's payer to cover the V2 price impact", async () => {
      const link = await createPaymentLink(appId, { amount: "2000" });
      stubV2Pairs([{ tokens: [WETH, USDC], reserves: steady }]);

      const quote = await service.createQuoteFromPaymentLink(appId, link.id, {
        chainId,
        sourceTokenAddress: WETH,
      });

      expect(quote).toMatchObject({
        targetAmount: 2_000_000_000n,
        sourceAmount: v2AmountIn(2_000_000_000n, WethReserve, UsdcReserve)!,
        uniswapPoolFeeTier: 0,
      });
    });
  });

  describe("reads", () => {
    it("keeps quotes inside their app and loads relations", async () => {
      const other = await createApp();
      await acceptChain(other.id, chainId);
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
