import {
  acceptChain,
  IMPLEMENTATION,
  createApp,
  createConfiguredChain,
  createCustomer,
  createPaymentLink,
  createToken,
  address,
  FACTORY,
  USDC,
  WETH,
} from "../../test/factories";
import {
  createDepositRow,
  createQuoteRow,
  createTransferRow,
  payinFor,
} from "../../test/transfers";
import {
  fakeActor,
  nearIntentsMock,
  operatorAddress,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import {
  app,
  appChain,
  chainConfig,
  deposit,
  event,
  operatorForward,
  quote as quoteTable,
  quoteFee,
  payout,
  token,
  transfer,
  transferTimeline,
} from "../../db/schema";
import {
  NotFoundError,
  QuoteExpiredError,
  TransferStructMismatchError,
} from "../../shared/errors";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OneHour,
  PayoutStatus,
  Provider,
  TransferStatus,
  WebhookCategory,
} from "../../shared/constants";
import { runProviderMethod } from "../../shared/providers";
import { TransferService } from "../Transfer.service";
import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
import { getChain } from "../../shared/chains";
import { common } from "../../shared/common";
import { kite } from "../../shared/kiteContract";
import { eq } from "drizzle-orm";
import { db } from "../../db";

vi.mock("../../shared/providers", () => ({
  runProviderMethod: vi.fn(async () => undefined),
  isProviderConfiguredForAction: vi.fn(),
  getProvider: vi.fn(),
  ProvidersMap: {},
}));

const service = new TransferService();

const SENDER = address(0x5e1);
const REFUND_TO = address(0x7e7);
const CAIP2 = "eip155:8453" as Caip2Id;

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

const events = () => db.select().from(event);
const timeline = () => db.select().from(transferTimeline);

describe("TransferService", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;
  let wethId: string;

  const spies = {
    predict: vi.spyOn(kite, "predictAddress"),
    simulate: vi.spyOn(kite, "simulateFactoryCall"),
    status: vi.spyOn(kite, "readStatus"),
    implementation: vi.spyOn(kite, "getImplementation"),
  };

  beforeEach(async () => {
    resetMocks();
    vi.mocked(runProviderMethod)
      .mockReset()
      .mockImplementation(async () => undefined as never);
    spies.predict.mockImplementation(async (_client, _factory, struct) =>
      payinFor(common.bytes32ToUuid(struct.id)!),
    );
    spies.simulate.mockResolvedValue({ ok: true });
    spies.status.mockResolvedValue("Open");
    spies.implementation.mockResolvedValue(IMPLEMENTATION);
    fakeActor.publicClient.mockResolvedValue({});

    appId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    await acceptChain(appId, chainId);
    usdcId = configured.usdc.id;
    wethId = (
      await createToken(chainId, {
        address: WETH,
        symbol: "WETH",
        decimals: 18,
      })
    ).id;
  });

  const newQuote = (
    values: Partial<Parameters<typeof createQuoteRow>[0]> = {},
  ) =>
    createQuoteRow({
      appId,
      chainId,
      sourceTokenId: usdcId,
      targetTokenId: usdcId,
      ...values,
    });

  const open = async (
    values: Partial<Parameters<typeof createTransferRow>[0]> & {
      quote?: Awaited<ReturnType<typeof newQuote>>;
    } = {},
  ) => {
    const quote = values.quote ?? (await newQuote());
    return createTransferRow({ appId, ...values, quote });
  };

  describe("createTransfer", () => {
    it("tells webhooks which payment link, and so which order, it pays", async () => {
      const link = await createPaymentLink(appId, {
        reference: "order-1",
        meta: { cart: "c-9" },
      });
      const quote = await newQuote({ paymentLinkId: link.id });

      await service.createTransfer(appId, quote.id, REFUND_TO.toLowerCase());

      const [created] = await events();
      expect(created.data).toMatchObject({
        quote: {
          paymentLink: {
            id: link.id,
            reference: "order-1",
            meta: { cart: "c-9" },
          },
        },
      });
    });

    it("opens a transfer awaiting deposit and announces it", async () => {
      const quote = await newQuote({
        sourceAmount: 2_000_000n,
        targetAmount: 2_000_000n,
      });

      const created = await service.createTransfer(
        appId,
        quote.id,
        REFUND_TO.toLowerCase(),
      );

      expect(created).toMatchObject({
        appId,
        quoteId: quote.id,
        status: TransferStatus.AwaitingDeposit,
        settlementRecipient: operatorAddress,
        refundAddress: REFUND_TO,
        minAmountOut: 1_980_000n,
        paymentInstructions: {
          caip2Id: CAIP2,
          address: payinFor(created.id),
          tokenAddress: USDC,
          amount: "2000000",
        },
      });
      expect(created.payinAddress).toBe(payinFor(created.id));
      expect(created.kiteTransferInput).toMatchObject({
        payInTokenAddress: USDC,
        settlementTokenAddress: USDC,
        amountIn: "2000000",
        minAmountOut: "1980000",
        routerAddress: "0x0000000000000000000000000000000000000000",
        refundAddress: REFUND_TO,
        fees: [],
      });

      const [created_event] = await events();
      expect(created_event).toMatchObject({
        appId,
        category: WebhookCategory.Transfer,
        previousCategoryStatus: TransferStatus.Created,
        currentCategoryStatus: TransferStatus.AwaitingDeposit,
      });
      expect(JSON.stringify(created_event.data)).not.toContain("rpcUrls");
      expect(JSON.stringify(created_event.data)).not.toContain("trackedBy");
      expect((await timeline())[0]).toMatchObject({
        transferId: created.id,
        eventId: created_event.id,
        description: "Transfer created; awaiting deposit",
      });
      expect(schedulerMock.enqueueEvent).toHaveBeenCalledWith(
        appId,
        created_event.id,
        expect.anything(),
      );
    });

    it("starts watching the pay-in address with the chain's notifier providers", async () => {
      const quote = await newQuote();
      const created = await service.createTransfer(appId, quote.id, REFUND_TO);

      const calls = vi.mocked(runProviderMethod).mock
        .calls as unknown as unknown[][];
      expect(calls.map((c) => c[1]).sort()).toEqual([
        "trackAddressActivity",
        "trackKiteContractEvent",
      ]);
      expect(calls.every((c) => (c[0] as string[]).includes("QuickNode"))).toBe(
        true,
      );
      expect(calls[0][2]).toEqual({
        caip2Id: CAIP2,
        address: created.payinAddress,
      });
      expect((await reload(created.id)).trackedBy).toEqual([
        Provider.QuickNode,
      ]);
      expect(created).not.toHaveProperty("trackedBy");
    });

    it("records the provider that took the address when an earlier one refuses", async () => {
      await db
        .update(chainConfig)
        .set({
          onchainNotifierProviders: [Provider.QuickNode, Provider.Alchemy],
        })
        .where(eq(chainConfig.chainId, chainId));
      vi.mocked(runProviderMethod).mockImplementation(async (providers) => {
        if (providers.includes(Provider.QuickNode)) throw new Error("403");
      });

      const created = await service.createTransfer(
        appId,
        (await newQuote()).id,
        REFUND_TO,
      );

      expect((await reload(created.id)).trackedBy).toEqual([Provider.Alchemy]);
    });

    it("records nobody on a chain without a notifier", async () => {
      await db
        .update(chainConfig)
        .set({ onchainNotifierProviders: [] })
        .where(eq(chainConfig.chainId, chainId));

      const created = await service.createTransfer(
        appId,
        (await newQuote()).id,
        REFUND_TO,
      );

      expect((await reload(created.id)).trackedBy).toEqual([]);
      expect(runProviderMethod).not.toHaveBeenCalled();
    });

    it("routes a Uniswap V2 quote through the V2 router", async () => {
      const quote = await newQuote({
        sourceTokenId: wethId,
        sourceAmount: 10n ** 15n,
        targetAmount: 3_000_000n,
      });

      await db
        .update(quoteTable)
        .set({ uniswapPoolFeeTier: 0 })
        .where(eq(quoteTable.id, quote.id));

      const created = await service.createTransfer(appId, quote.id, REFUND_TO);

      expect(created.kiteTransferInput).toMatchObject({
        poolFeeTier: 0,
        routerAddress: getChain(CAIP2).contracts.Uniswap?.UniswapV2Router02,
        implementation: IMPLEMENTATION,
      });
      expect(spies.implementation).toHaveBeenCalledWith(
        expect.anything(),
        FACTORY,
      );
    });

    it("routes a different pay-in token through the Uniswap router and carries the fees", async () => {
      const quote = await newQuote({
        sourceTokenId: wethId,
        sourceAmount: 10n ** 15n,
        targetAmount: 3_000_000n,
      });
      await db
        .update(quoteTable)
        .set({ uniswapPoolFeeTier: 500 })
        .where(eq(quoteTable.id, quote.id));
      const [fee] = await db
        .insert(quoteFee)
        .values({
          quoteId: quote.id,
          label: "platform",
          amount: 9_000n,
          feeAddress: address(0xfee),
        })
        .returning();

      const created = await service.createTransfer(appId, quote.id, REFUND_TO);

      expect(created.kiteTransferInput).toMatchObject({
        payInTokenAddress: WETH,
        settlementTokenAddress: USDC,
        poolFeeTier: 500,
        routerAddress: getChain(CAIP2).contracts.Uniswap?.SwapRouter02,
        implementation: IMPLEMENTATION,
        fees: [
          {
            id: common.uuidToBytes32(fee.id),
            recipient: address(0xfee),
            amount: "9000",
          },
        ],
      });
    });

    it("settles to the app's address on the chain", async () => {
      await db
        .update(appChain)
        .set({ address: address(0x5e77) })
        .where(eq(appChain.appId, appId));

      const created = await service.createTransfer(
        appId,
        (await newQuote()).id,
        REFUND_TO,
      );
      expect(created.settlementRecipient).toBe(address(0x5e77));
      expect(created.kiteTransferInput).toMatchObject({
        settlementRecipient: address(0x5e77),
      });
    });

    it("refuses a chain the app doesn't take payments on", async () => {
      await db.delete(appChain).where(eq(appChain.appId, appId));

      await expect(
        service.createTransfer(appId, (await newQuote()).id, REFUND_TO),
      ).rejects.toThrow("App doesn't accept payments on Base");
    });

    describe("payouts through NEAR Intents", () => {
      const BASE_USDC =
        "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
      const NEAR_USDC =
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
      const DEPOSIT = address(0xde90);
      const deadline = new Date(Date.now() + 86_400_000);

      const payTo = (payoutAsset: string, payoutAddress: string) =>
        db
          .update(app)
          .set({ payoutAsset, payoutAddress })
          .where(eq(app.id, appId));

      beforeEach(async () => {
        await db
          .update(token)
          .set({ nearIntentsAssetId: BASE_USDC })
          .where(eq(token.id, usdcId));
        await payTo(NEAR_USDC, "shop.near");
        nearIntentsMock.getTokens.mockResolvedValue([
          {
            assetId: NEAR_USDC,
            blockchain: "near",
            symbol: "USDC",
            decimals: 6,
          },
        ]);
        nearIntentsMock.quote.mockResolvedValue({
          signature: "ed25519:sig",
          quote: {
            depositAddress: DEPOSIT.toLowerCase(),
            amountIn: "999000",
            minAmountIn: "984015",
            amountOut: "998000",
            minAmountOut: "983030",
            deadline: deadline.toISOString(),
          },
        });
      });

      it("settles into a NEAR Intents deposit address and records the payout", async () => {
        const quote = await newQuote();
        await db.insert(quoteFee).values({
          quoteId: quote.id,
          label: "platform",
          amount: 1_000n,
          feeAddress: address(0xfee),
        });

        const created = await service.createTransfer(
          appId,
          quote.id,
          REFUND_TO,
        );

        expect(created.settlementRecipient).toBe(DEPOSIT);
        expect(nearIntentsMock.quote).toHaveBeenCalledWith(
          expect.objectContaining({
            dry: false,
            swapType: "FLEX_INPUT",
            slippageTolerance: 150,
            originAsset: BASE_USDC,
            depositType: "ORIGIN_CHAIN",
            destinationAsset: NEAR_USDC,
            amount: "999000",
            refundTo: operatorAddress,
            refundType: "ORIGIN_CHAIN",
            recipient: "shop.near",
            recipientType: "DESTINATION_CHAIN",
          }),
          expect.anything(),
        );

        const [row] = await db
          .select()
          .from(payout)
          .where(eq(payout.transferId, created.id));
        expect(row).toMatchObject({
          depositAddress: DEPOSIT,
          destinationAsset: NEAR_USDC,
          destinationSymbol: "USDC",
          destinationChain: "near",
          recipient: "shop.near",
          refundTo: operatorAddress,
          status: PayoutStatus.Pending,
          deadline,
        });
        expect((await timeline())[0].description).toBe(
          "Transfer created; awaiting deposit. Paid out as USDC on near to shop.near through NEAR Intents",
        );
      });

      it("settles straight to the payout address when nothing needs converting", async () => {
        await payTo(BASE_USDC, address(0xbeef));

        const created = await service.createTransfer(
          appId,
          (await newQuote()).id,
          REFUND_TO,
        );

        expect(created.settlementRecipient).toBe(address(0xbeef));
        expect(nearIntentsMock.quote).not.toHaveBeenCalled();
      });

      it("settles to the app's address where NEAR Intents can't pay out from", async () => {
        await db
          .update(token)
          .set({ nearIntentsAssetId: null })
          .where(eq(token.id, usdcId));

        const created = await service.createTransfer(
          appId,
          (await newQuote()).id,
          REFUND_TO,
        );

        expect(created.settlementRecipient).toBe(operatorAddress);
        expect(nearIntentsMock.quote).not.toHaveBeenCalled();
        expect((await timeline())[0].description).toBe(
          `Transfer created; awaiting deposit. NEAR Intents can't pay out from Base, so it settles to ${operatorAddress}`,
        );
      });

      it("settles to the app's address when NEAR Intents can't quote", async () => {
        nearIntentsMock.quote.mockRejectedValue(new Error("no route"));

        const created = await service.createTransfer(
          appId,
          (await newQuote()).id,
          REFUND_TO,
        );

        expect(created.settlementRecipient).toBe(operatorAddress);
        expect(await db.select().from(payout)).toEqual([]);
        expect((await timeline())[0].description).toContain(
          "NEAR Intents couldn't quote a payout (no route)",
        );
      });
    });

    it("uses a quote only once", async () => {
      const quote = await newQuote();
      await service.createTransfer(appId, quote.id, REFUND_TO);

      await expect(
        service.createTransfer(appId, quote.id, REFUND_TO),
      ).rejects.toThrow("Quote has been consumed");
    });

    it("creates one transfer when the same quote is used concurrently", async () => {
      const quote = await newQuote();
      const results = await Promise.allSettled([
        service.createTransfer(appId, quote.id, REFUND_TO),
        service.createTransfer(appId, quote.id, REFUND_TO),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.select().from(transfer)).toHaveLength(1);
    });

    it("does not turn another app's quote into a transfer", async () => {
      const other = await createApp();
      const quote = await createQuoteRow({
        appId: other.id,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });

      await expect(
        service.createTransfer(appId, quote.id, REFUND_TO),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuses an expired quote", async () => {
      const quote = await newQuote({ expiresAt: new Date(Date.now() - 1000) });

      await expect(
        service.createTransfer(appId, quote.id, REFUND_TO),
      ).rejects.toBeInstanceOf(QuoteExpiredError);
    });

    it("refuses a malformed or zero refund address", async () => {
      const quote = await newQuote();

      await expect(
        service.createTransfer(appId, quote.id, "0x123"),
      ).rejects.toThrow("refund address is not a valid address");
      await expect(
        service.createTransfer(appId, quote.id, address(0)),
      ).rejects.toThrow("refund address cannot be the zero address");
    });

    it("opens a transfer on a chain without a deposit notifier", async () => {
      await db
        .update(chainConfig)
        .set({ onchainNotifierProviders: [] })
        .where(eq(chainConfig.chainId, chainId));

      const quote = await newQuote();
      const created = await service.createTransfer(appId, quote.id, REFUND_TO);

      expect(created.status).toBe(TransferStatus.AwaitingDeposit);
      expect(vi.mocked(runProviderMethod)).not.toHaveBeenCalled();
    });

    it("does not save anything when the contract would reject the deployment", async () => {
      const quote = await newQuote();
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "TooManyFees",
        message: "reverted",
      });

      await expect(
        service.createTransfer(appId, quote.id, REFUND_TO),
      ).rejects.toThrow("TooManyFees");

      expect(await db.select().from(transfer)).toHaveLength(0);
      expect(await events()).toHaveLength(0);
      expect(vi.mocked(runProviderMethod)).not.toHaveBeenCalled();
    });

    it("keeps the transfer and its event atomic if queuing fails", async () => {
      const quote = await newQuote();
      schedulerMock.enqueueEvent.mockRejectedValueOnce(new Error("queue down"));

      await expect(
        service.createTransfer(appId, quote.id, REFUND_TO),
      ).rejects.toThrow("queue down");
      expect(await db.select().from(transfer)).toHaveLength(0);
      expect(await events()).toHaveLength(0);
    });
  });

  describe("transitionTransferStatus", () => {
    it("moves a transfer once and records the event and timeline", async () => {
      const row = await open();

      const first = await service.transitionTransferStatus(
        row.id,
        TransferStatus.AwaitingDeposit,
        TransferStatus.DepositReceived,
        "Expected deposit received",
      );
      const second = await service.transitionTransferStatus(
        row.id,
        TransferStatus.AwaitingDeposit,
        TransferStatus.DepositReceived,
        "Expected deposit received",
      );

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect((await reload(row.id)).status).toBe(
        TransferStatus.DepositReceived,
      );
      expect(await events()).toHaveLength(1);
      expect(await timeline()).toHaveLength(1);
    });

    it("refuses a move from a status the transfer is not in", async () => {
      const row = await open({ status: TransferStatus.Settled });

      expect(
        await service.transitionTransferStatus(
          row.id,
          TransferStatus.AwaitingDeposit,
          TransferStatus.Failed,
          "x",
        ),
      ).toBe(false);
      expect((await reload(row.id)).status).toBe(TransferStatus.Settled);
    });

    it("stores the settlement hash only for settled transfers", async () => {
      const row = await open({ status: TransferStatus.Processing });

      await service.transitionTransferStatus(
        row.id,
        TransferStatus.Processing,
        TransferStatus.Settled,
        "Transfer settled",
        { settlementBlockchainHash: "0xabc", refundBlockchainHash: "0xnope" },
      );

      expect(await reload(row.id)).toMatchObject({
        status: TransferStatus.Settled,
        settlementBlockchainHash: "0xabc",
        refundBlockchainHash: null,
      });
    });
  });

  describe("watching the pay-in address", () => {
    it.each([
      [TransferStatus.Settled, 0],
      [TransferStatus.Refunded, 0],
      [TransferStatus.Failed, 0],
      [TransferStatus.Cancelled, 12 * OneHour],
    ])(
      "stops once the transfer is %s, %i seconds later",
      async (status, delay) => {
        const row = await open();

        await service.transitionTransferStatus(
          row.id,
          TransferStatus.AwaitingDeposit,
          status,
          "Closed",
        );

        expect(schedulerMock.enqueueUntrack).toHaveBeenCalledWith(
          row.id,
          delay,
          expect.anything(),
        );
      },
    );

    it("checks the payout once a paid-out transfer settles", async () => {
      const paidOut = await open({ status: TransferStatus.Processing });
      const plain = await open({ status: TransferStatus.Processing });
      await db.insert(payout).values({
        transferId: paidOut.id,
        depositAddress: address(0xde90),
        destinationAsset: "nep141:usdc.near",
        destinationSymbol: "USDC",
        destinationChain: "near",
        recipient: "shop.near",
        refundTo: operatorAddress,
        deadline: new Date(Date.now() + 86_400_000),
        status: PayoutStatus.Pending,
        quote: {},
      });

      for (const row of [paidOut, plain]) {
        await service.transitionTransferStatus(
          row.id,
          TransferStatus.Processing,
          TransferStatus.Settled,
          "Transfer settled",
        );
      }

      expect(schedulerMock.enqueueCheckPayout.mock.calls).toEqual([
        [paidOut.id, expect.anything()],
      ]);
    });

    it("keeps watching an open transfer", async () => {
      const row = await open();

      await service.transitionTransferStatus(
        row.id,
        TransferStatus.AwaitingDeposit,
        TransferStatus.DepositReceived,
        "Expected deposit received",
      );
      await service.transitionTransferStatus(
        row.id,
        TransferStatus.AwaitingDeposit,
        TransferStatus.Settled,
        "Not from this status",
      );

      expect(schedulerMock.enqueueUntrack).not.toHaveBeenCalled();
    });

    it("stops once the settlement lands", async () => {
      const row = await open({ status: TransferStatus.Processing });

      await service.handleOnchainNotifierCallback([
        {
          type: "Settled",
          caip2Id: CAIP2,
          payinAddress: row.payinAddress,
          transferId: row.id,
          blockchainHash: "0xsettled",
          logIndex: "1",
        },
      ]);

      expect(schedulerMock.enqueueUntrack).toHaveBeenCalledWith(
        row.id,
        0,
        expect.anything(),
      );
    });

    const trackedBy = async (id: string, providers: Provider[]) => {
      await db
        .update(transfer)
        .set({ trackedBy: providers })
        .where(eq(transfer.id, id));
    };

    it("asks only the providers watching the address, and crosses each off", async () => {
      await db
        .update(chainConfig)
        .set({
          onchainNotifierProviders: [Provider.QuickNode, Provider.Alchemy],
        })
        .where(eq(chainConfig.chainId, chainId));
      const row = await open({ status: TransferStatus.Settled });
      await trackedBy(row.id, [Provider.Alchemy]);

      await service.untrackTransfer(row.id);

      const calls = vi.mocked(runProviderMethod).mock
        .calls as unknown as unknown[][];
      const address = row.payinAddress;
      expect(calls.map((call) => call.slice(0, 3))).toEqual([
        [
          [Provider.Alchemy],
          "untrackAddressActivity",
          { caip2Id: CAIP2, address },
        ],
        [
          [Provider.Alchemy],
          "untrackKiteContractEvent",
          { caip2Id: CAIP2, contractAddress: address },
        ],
      ]);
      expect((await reload(row.id)).trackedBy).toEqual([]);
    });

    it("keeps a provider on record until it has forgotten the address", async () => {
      const row = await open({ status: TransferStatus.Settled });
      await trackedBy(row.id, [Provider.QuickNode, Provider.Alchemy]);
      vi.mocked(runProviderMethod).mockImplementation(async (providers) => {
        if (providers.includes(Provider.Alchemy)) throw new Error("500");
      });

      await expect(service.untrackTransfer(row.id)).rejects.toThrow("500");

      expect((await reload(row.id)).trackedBy).toEqual([Provider.Alchemy]);
    });

    it("calls nobody once nothing watches the address", async () => {
      const row = await open({ status: TransferStatus.Settled });

      await service.untrackTransfer(row.id);

      expect(runProviderMethod).not.toHaveBeenCalled();
    });
  });

  describe("settleTransfer", () => {
    it("ignores a transfer that is no longer settleable", async () => {
      const row = await open({ status: TransferStatus.Settled });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);

      await service.settleTransfer(row.id);
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("stops if the stored transfer no longer matches its on-chain address", async () => {
      const row = await open();
      spies.predict.mockResolvedValue(address(0xbad));

      await expect(service.settleTransfer(row.id)).rejects.toBeInstanceOf(
        TransferStructMismatchError,
      );
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("waits quietly for a deposit while the transfer is open", async () => {
      const row = await open();
      fakeActor.getBalance.mockResolvedValue(400_000n);

      await service.settleTransfer(row.id);

      expect((await reload(row.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("asks to be retried when a deposit was seen but the balance is short", async () => {
      const row = await open({ status: TransferStatus.DepositReceived });
      fakeActor.getBalance.mockResolvedValue(400_000n);

      await expect(service.settleTransfer(row.id)).rejects.toThrow(
        "awaiting full deposit",
      );
    });

    it("cancels an unpaid transfer once it expires", async () => {
      const quote = await newQuote({ expiresAt: new Date(Date.now() - 1000) });
      const row = await open({ quote });

      await service.settleTransfer(row.id);

      expect((await reload(row.id)).status).toBe(TransferStatus.Cancelled);
      expect(schedulerMock.enqueueRefund).not.toHaveBeenCalled();
    });

    it("fails an expired transfer that holds funds and queues the refund", async () => {
      const quote = await newQuote({ expiresAt: new Date(Date.now() - 1000) });
      const row = await open({ quote });
      fakeActor.getBalance.mockResolvedValue(300_000n);

      await service.settleTransfer(row.id);

      expect((await reload(row.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(
        row.id,
        expect.anything(),
      );
    });

    it("holds the funds, without refunding, once an x402 payment was accepted", async () => {
      const quote = await newQuote({ expiresAt: new Date(Date.now() - 1000) });
      const row = await open({
        quote,
        status: TransferStatus.x402Settled,
        x402SettledAt: new Date(),
      });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);

      await service.settleTransfer(row.id);

      expect((await reload(row.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).not.toHaveBeenCalled();
    });

    it("submits the settlement call when the deposit is complete", async () => {
      const row = await open({ status: TransferStatus.DepositReceived });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      fakeActor.sendTransaction.mockResolvedValue("0xsettle");

      await service.settleTransfer(row.id);

      const struct = kite.deserializeTransferInput(row.kiteTransferInput);
      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        {
          caip2Id: CAIP2,
          to: FACTORY,
          data: kite.factory.settle(struct),
          value: 0n,
        },
        expect.anything(),
        expect.anything(),
      );
      expect((await reload(row.id)).status).toBe(TransferStatus.Processing);
      expect((await timeline()).map((t) => t.description)).toEqual([
        "Transfer settlement submitted",
      ]);
    });

    it("marks the transfer settled from the receipt's Settled log", async () => {
      const row = await open({ status: TransferStatus.DepositReceived });
      const struct = kite.deserializeTransferInput(row.kiteTransferInput);
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      fakeActor.sendTransaction.mockResolvedValue("0xsettle");

      const topics = encodeEventTopics({
        abi: Kite__factory.abi,
        eventName: "Settled",
        args: {
          transferId: struct.id,
          settlementRecipient: struct.settlementRecipient,
          settlementToken: struct.settlementTokenAddress,
        },
      });
      const data = encodeAbiParameters(
        [
          { type: "address" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [struct.payInTokenAddress, 1_000_000n, 1_000_000n, 0n],
      );

      fakeActor.waitForReceipt.mockResolvedValue({
        transactionHash: "0xsettle",
        logs: [
          {
            address: row.payinAddress,
            topics,
            data,
            logIndex: 4,
            transactionHash: "0xsettle",
          },
        ],
      });

      await service.settleTransfer(row.id);

      expect(await reload(row.id)).toMatchObject({
        status: TransferStatus.Settled,
        settlementBlockchainHash: "0xsettle",
      });
    });

    it("retries on transient simulation failures", async () => {
      const row = await open({ status: TransferStatus.DepositReceived });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "transient",
        message: "rpc down",
      });

      await expect(service.settleTransfer(row.id)).rejects.toThrow("rpc down");
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("reconciles a transfer the contract already closed", async () => {
      const row = await open({ status: TransferStatus.Processing });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "InvoiceNotOpen",
        message: "closed",
      });
      spies.status.mockResolvedValue("Settled");

      await service.settleTransfer(row.id);

      expect((await reload(row.id)).status).toBe(TransferStatus.Settled);
      expect(schedulerMock.enqueueRecover).toHaveBeenCalled();
    });

    it("won't settle into a payout deposit address that is about to expire", async () => {
      const row = await open({ status: TransferStatus.DepositReceived });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      await db.insert(payout).values({
        transferId: row.id,
        depositAddress: address(0xde90),
        destinationAsset: "nep141:usdc.near",
        destinationSymbol: "USDC",
        destinationChain: "near",
        recipient: "shop.near",
        refundTo: operatorAddress,
        deadline: new Date(Date.now() + 10 * 60_000),
        status: PayoutStatus.Pending,
        quote: {},
      });

      await service.settleTransfer(row.id);

      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
      expect((await reload(row.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(
        row.id,
        expect.anything(),
      );
    });

    it("fails and refunds when the contract rejects the settlement", async () => {
      const row = await open({ status: TransferStatus.Processing });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "BelowMin",
        message: "below min",
      });

      await service.settleTransfer(row.id);

      expect((await reload(row.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(
        row.id,
        expect.anything(),
      );
      expect((await timeline()).at(-1)?.description).toBe(
        "Settlement failed (BelowMin)",
      );
    });

    it("waits when the contract does not see the deposit yet", async () => {
      const row = await open({ status: TransferStatus.DepositReceived });
      fakeActor.getBalance.mockResolvedValue(1_000_000n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "InsufficientPayment",
        message: "x",
      });

      await expect(service.settleTransfer(row.id)).rejects.toThrow(
        "Deposit not visible to the contract yet",
      );
    });
  });

  describe("refundTransfer", () => {
    it("refunds an open transfer", async () => {
      const row = await open({ status: TransferStatus.Failed });
      const struct = kite.deserializeTransferInput(row.kiteTransferInput);
      fakeActor.getBalance.mockResolvedValue(25n);

      expect(await service.refundTransfer(row.id)).toEqual({ refunded: true });

      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to: FACTORY,
          data: kite.factory.refund(struct),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it.each([
      [TransferStatus.Settled, null],
      [TransferStatus.Refunded, null],
      [TransferStatus.Failed, new Date()],
    ])(
      "does nothing for a %s transfer (x402 settled: %s)",
      async (status, settled) => {
        const row = await open({ status, x402SettledAt: settled });
        fakeActor.getBalance.mockResolvedValue(25n);

        expect(await service.refundTransfer(row.id)).toMatchObject({
          refunded: false,
        });
        expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
      },
    );

    it("does nothing when the pay-in address is empty", async () => {
      const row = await open({ status: TransferStatus.Cancelled });

      expect(await service.refundTransfer(row.id)).toEqual({
        refunded: false,
        reason: "There is nothing to refund: the pay-in address holds no USDC",
      });
      expect(spies.simulate).not.toHaveBeenCalled();
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("refunds a cancelled transfer that was paid after it expired", async () => {
      const row = await open({ status: TransferStatus.Cancelled });
      fakeActor.getBalance.mockResolvedValue(25n);

      expect(await service.refundTransfer(row.id)).toEqual({ refunded: true });
    });

    it("reconciles when the transfer is already closed on-chain", async () => {
      const row = await open({ status: TransferStatus.Failed });
      fakeActor.getBalance.mockResolvedValue(25n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "InvoiceNotOpen",
        message: "closed",
      });
      spies.status.mockResolvedValue("Refunded");

      expect(await service.refundTransfer(row.id)).toMatchObject({
        refunded: false,
      });
      expect((await reload(row.id)).status).toBe(TransferStatus.Refunded);
    });

    it("surfaces contract rejections so the job retries", async () => {
      const row = await open({ status: TransferStatus.Failed });
      fakeActor.getBalance.mockResolvedValue(25n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "NotExpired",
        message: "x",
      });

      await expect(service.refundTransfer(row.id)).rejects.toThrow(
        "NotExpired",
      );
    });
  });

  describe("recovery", () => {
    it("skips transfers with nothing to recover", async () => {
      const row = await open({ status: TransferStatus.Settled });
      fakeActor.getBalance.mockResolvedValue(0n);

      await service.recoverTransferToken(row.id, USDC);
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("recovers a stray balance to the zero address, to be forwarded later", async () => {
      const row = await open({ status: TransferStatus.Settled });
      const struct = kite.deserializeTransferInput(row.kiteTransferInput);
      fakeActor.getBalance.mockResolvedValue(25n);

      await service.recoverTransferToken(row.id, WETH);

      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: kite.factory.recover(
            struct,
            WETH,
            "0x0000000000000000000000000000000000000000",
          ),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it("leaves funds of an accepted x402 payment alone", async () => {
      const row = await open({
        status: TransferStatus.Failed,
        x402SettledAt: new Date(),
      });
      fakeActor.getBalance.mockResolvedValue(25n);

      await service.recoverTransferToken(row.id, USDC);
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("retries when recovery fails for a transient reason", async () => {
      const row = await open({ status: TransferStatus.Settled });
      fakeActor.getBalance.mockResolvedValue(25n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "transient",
        message: "rpc",
      });

      await expect(service.recoverTransferToken(row.id, USDC)).rejects.toThrow(
        "rpc",
      );
    });

    it("quietly waits while the transfer is still open", async () => {
      const row = await open({ status: TransferStatus.AwaitingDeposit });
      fakeActor.getBalance.mockResolvedValue(25n);
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "RecoveryNotAllowed",
        message: "open",
      });

      await expect(
        service.recoverTransferToken(row.id, USDC),
      ).resolves.toBeUndefined();
    });

    it("sends a manual recovery to the destination you choose", async () => {
      const row = await open({ status: TransferStatus.Settled });
      const struct = kite.deserializeTransferInput(row.kiteTransferInput);
      fakeActor.getBalance.mockResolvedValue(25n);

      await service.recover(row.id, USDC.toLowerCase(), address(0xd357));

      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          data: kite.factory.recover(struct, USDC, address(0xd357)),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it("checks the selected token balance at the pay-in address", async () => {
      const row = await open();
      fakeActor.getBalance.mockResolvedValue(25n);

      await expect(service.getRecoveryBalance(row.id, USDC)).resolves.toBe(25n);
      expect(fakeActor.getBalance).toHaveBeenCalledWith(
        CAIP2,
        USDC,
        row.payinAddress,
      );
    });

    it("uses a direct operator transaction when gas sponsorship is disabled", async () => {
      const row = await open({ status: TransferStatus.Settled });
      fakeActor.getBalance.mockResolvedValue(25n);

      await service.recover(row.id, USDC, address(0xd357), false);

      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { useGasSponsor: false },
      );
    });
  });

  describe("sweep", () => {
    it("re-drives open transfers, expired ones and long-stuck ones", async () => {
      const waiting = await open();
      const expired = await open({
        status: TransferStatus.DepositReceived,
        quote: await newQuote({ expiresAt: new Date(Date.now() - 1000) }),
      });
      const fresh = await open({ status: TransferStatus.Processing });
      const stuck = await open({ status: TransferStatus.Processing });
      const done = await open({ status: TransferStatus.Settled });
      await db
        .update(transfer)
        .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
        .where(eq(transfer.id, stuck.id));

      await service.sweep();

      const queued = schedulerMock.enqueueSettle.mock.calls.map(
        (c) => (c as unknown[])[0],
      );
      expect(queued.sort()).toEqual([waiting.id, expired.id, stuck.id].sort());
      expect(queued).not.toContain(fresh.id);
      expect(queued).not.toContain(done.id);
    });

    it("leaves failed transfers to the refund job queued when they failed", async () => {
      const failed = await open({ status: TransferStatus.Failed });
      await db
        .update(transfer)
        .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
        .where(eq(transfer.id, failed.id));

      await service.sweep();

      expect(schedulerMock.enqueueRefund).not.toHaveBeenCalled();
      expect(schedulerMock.enqueueSettle).not.toHaveBeenCalled();
    });
  });

  describe("handleOnchainNotifierCallback", () => {
    const tx = `0x${"aa".repeat(32)}`;

    const deposited = (
      row: { payinAddress: string },
      overrides: Partial<{
        amount: bigint;
        from: string;
        tokenAddress: string;
        logIndex: string;
        blockchainHash: string;
      }> = {},
    ): OnchainNotifierCallbackResultItem => ({
      type: "DepositReceived",
      caip2Id: CAIP2,
      payinAddress: row.payinAddress,
      blockchainHash: overrides.blockchainHash ?? tx,
      logIndex: overrides.logIndex ?? "1",
      from: overrides.from ?? SENDER,
      tokenAddress: overrides.tokenAddress ?? USDC,
      amount: overrides.amount ?? 1_000_000n,
    });

    it("ignores addresses it does not know and chains it does not serve", async () => {
      const row = await open();

      await service.handleOnchainNotifierCallback([
        deposited({ payinAddress: address(0x404) }),
        { ...deposited(row), caip2Id: "eip155:1" },
      ]);

      expect(await db.select().from(deposit)).toHaveLength(0);
    });

    it("records a full deposit, marks it received and queues settlement", async () => {
      const row = await open();

      await service.handleOnchainNotifierCallback([deposited(row)]);

      expect(await db.select().from(deposit)).toHaveLength(1);
      expect((await reload(row.id)).status).toBe(
        TransferStatus.DepositReceived,
      );
      expect(schedulerMock.enqueueSettle).toHaveBeenCalledWith(row.id);
      const categories = (await events()).map((e) => e.category).sort();
      expect(categories).toEqual(
        [WebhookCategory.Deposit, WebhookCategory.Transfer].sort(),
      );
    });

    it("waits for the rest of a partial deposit", async () => {
      const row = await open();

      await service.handleOnchainNotifierCallback([
        deposited(row, { amount: 400_000n, logIndex: "1" }),
      ]);
      expect((await reload(row.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
      expect(schedulerMock.enqueueSettle).not.toHaveBeenCalled();

      await service.handleOnchainNotifierCallback([
        deposited(row, { amount: 600_000n, logIndex: "2" }),
      ]);
      expect((await reload(row.id)).status).toBe(
        TransferStatus.DepositReceived,
      );
      expect(schedulerMock.enqueueSettle).toHaveBeenCalledTimes(1);
    });

    it("counts a repeated notification once", async () => {
      const row = await open();
      const item = deposited(row, { amount: 600_000n });

      await service.handleOnchainNotifierCallback([item]);
      await service.handleOnchainNotifierCallback([item]);

      expect(await db.select().from(deposit)).toHaveLength(1);
      expect((await reload(row.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
    });

    it("recovers tokens other than the pay-in token", async () => {
      const row = await open();

      await service.handleOnchainNotifierCallback([
        deposited(row, { tokenAddress: WETH, amount: 5n }),
      ]);

      expect((await reload(row.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
      expect(schedulerMock.enqueueRecover).toHaveBeenCalledWith(row.id, WETH);
    });

    it("recovers late deposits into closed transfers and refunds cancelled ones", async () => {
      const settled = await open({ status: TransferStatus.Settled });
      const cancelled = await open({ status: TransferStatus.Cancelled });
      const failed = await open({ status: TransferStatus.Failed });

      await service.handleOnchainNotifierCallback([
        deposited(settled, { logIndex: "1" }),
        deposited(cancelled, { logIndex: "2" }),
        deposited(failed, { logIndex: "3" }),
      ]);

      expect(schedulerMock.enqueueRecover).toHaveBeenCalledWith(
        settled.id,
        USDC,
      );
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(cancelled.id);
      expect(schedulerMock.enqueueRefund).not.toHaveBeenCalledWith(failed.id);
      expect((await reload(failed.id)).status).toBe(TransferStatus.Failed);
    });

    it("remembers the transaction that carried an x402 payment", async () => {
      const row = await open({ x402Payer: SENDER });

      await service.handleOnchainNotifierCallback([deposited(row)]);

      expect((await reload(row.id)).x402BlockchainHash).toBe(tx);
    });

    it("marks a transfer settled and queues leftover recovery", async () => {
      const row = await open({ status: TransferStatus.Processing });

      await service.handleOnchainNotifierCallback([
        {
          type: "Settled",
          caip2Id: CAIP2,
          payinAddress: row.payinAddress,
          blockchainHash: tx,
          logIndex: "5",
          transferId: "0x",
        },
      ]);

      expect(await reload(row.id)).toMatchObject({
        status: TransferStatus.Settled,
        settlementBlockchainHash: tx,
      });
      expect(schedulerMock.enqueueRecover).toHaveBeenCalledWith(row.id, USDC);
    });

    it("records a refund and describes undelivered ones", async () => {
      const delivered = await open({ status: TransferStatus.Failed });
      const undelivered = await open({ status: TransferStatus.Failed });
      fakeActor.getBalance
        .mockResolvedValueOnce(0n)
        .mockResolvedValueOnce(900n);

      const refunded = (
        row: { payinAddress: string },
        amount: bigint,
        logIndex: string,
      ): OnchainNotifierCallbackResultItem => ({
        type: "Refunded",
        caip2Id: CAIP2,
        payinAddress: row.payinAddress,
        blockchainHash: tx,
        logIndex,
        transferId: "0x",
        refundAddress: REFUND_TO,
        amountRefunded: amount,
      });

      await service.handleOnchainNotifierCallback([
        refunded(delivered, 1_000_000n, "6"),
        refunded(undelivered, 0n, "7"),
      ]);

      expect(await reload(delivered.id)).toMatchObject({
        status: TransferStatus.Refunded,
        refundBlockchainHash: tx,
      });
      const descriptions = (await timeline()).map((t) => t.description);
      expect(descriptions).toContain(`Refunded 1 USDC to ${REFUND_TO}`);
      expect(descriptions).toContain(
        `Refund to ${REFUND_TO} could not be delivered`,
      );
    });

    it("turns refunds that landed in the operator wallet into payouts", async () => {
      const row = await open({
        status: TransferStatus.Failed,
        refundAddress: operatorAddress,
        x402Payer: SENDER,
      });

      await service.handleOnchainNotifierCallback([
        {
          type: "Refunded",
          caip2Id: CAIP2,
          payinAddress: row.payinAddress,
          blockchainHash: tx,
          logIndex: "8",
          transferId: "0x",
          refundAddress: operatorAddress,
          amountRefunded: 1_000_000n,
        },
      ]);

      const [forward] = await db.select().from(operatorForward);
      expect(forward).toMatchObject({
        transferId: row.id,
        recipient: SENDER,
        amount: 1_000_000n,
      });
    });

    it("announces excess and recovered funds exactly once", async () => {
      const row = await open({ status: TransferStatus.Settled });
      const excess: OnchainNotifierCallbackResultItem = {
        type: "ExcessRefunded",
        caip2Id: CAIP2,
        payinAddress: row.payinAddress,
        blockchainHash: tx,
        logIndex: "9",
        transferId: "0x",
        tokenAddress: USDC,
        amount: 10n,
        to: REFUND_TO,
      };
      const recovered: OnchainNotifierCallbackResultItem = {
        type: "Recovered",
        caip2Id: CAIP2,
        payinAddress: row.payinAddress,
        blockchainHash: tx,
        logIndex: "10",
        transferId: "0x",
        tokenAddress: USDC,
        amount: 11n,
        to: REFUND_TO,
      };

      await service.handleOnchainNotifierCallback([excess, recovered]);
      await service.handleOnchainNotifierCallback([excess, recovered]);

      const categories = (await events()).map((e) => e.category).sort();
      expect(categories).toEqual(
        [WebhookCategory.ExcessRefund, WebhookCategory.Recovery].sort(),
      );
    });

    it("stores a fee receipt on the matching quote fee", async () => {
      const row = await open({ status: TransferStatus.Processing });
      const [fee] = await db
        .insert(quoteFee)
        .values({
          quoteId: row.quoteId,
          label: "platform",
          amount: 5n,
          feeAddress: address(0xfee),
        })
        .returning();

      await service.handleOnchainNotifierCallback([
        {
          type: "FeePaid",
          caip2Id: CAIP2,
          payinAddress: row.payinAddress,
          blockchainHash: tx,
          logIndex: "11",
          transferId: "0x",
          feeId: common.uuidToBytes32(fee.id),
        },
      ]);

      const [stored] = await db
        .select()
        .from(quoteFee)
        .where(eq(quoteFee.id, fee.id));
      expect(stored.blockchainHash).toBe(tx);
    });

    it("keeps going when one item fails and reports it", async () => {
      const row = await open();
      const bad = deposited(row, {
        tokenAddress: address(0xbad),
        logIndex: "1",
      });
      const good = deposited(row, { logIndex: "2" });

      await expect(
        service.handleOnchainNotifierCallback([bad, good]),
      ).resolves.toBeUndefined();
      expect((await reload(row.id)).status).toBe(
        TransferStatus.DepositReceived,
      );
    });
  });

  describe("reads", () => {
    it("loads a transfer with its quote and finds it by pay-in address", async () => {
      const row = await open();

      const byId = await service.getTransfer(appId, row.id);
      const byAddress = await service.getTransferByPayinAddress(
        appId,
        row.payinAddress.toLowerCase(),
      );

      expect(byId?.quote.sourceToken.symbol).toBe("USDC");
      expect(byAddress?.id).toBe(row.id);
    });

    it("keeps transfers inside their app", async () => {
      const row = await open();
      const other = await createApp();

      expect(await service.getTransfer(other.id, row.id)).toBeUndefined();
      expect(
        await service.getTransferByPayinAddress(other.id, row.payinAddress),
      ).toBeUndefined();
    });

    it("lists newest first with status and app filters", async () => {
      const other = await createApp();
      const a = await open();
      const b = await open({ status: TransferStatus.Settled });
      const c = await createTransferRow({
        appId: other.id,
        quote: await createQuoteRow({
          appId: other.id,
          chainId,
          sourceTokenId: usdcId,
          targetTokenId: usdcId,
        }),
      });

      expect(
        (await service.getTransfers({ appId })).data.map((t) => t.id),
      ).toEqual([b.id, a.id]);
      expect(
        (
          await service.getTransfers({ appId, status: TransferStatus.Settled })
        ).data.map((t) => t.id),
      ).toEqual([b.id]);
      expect((await service.getTransfers({})).data.map((t) => t.id)).toEqual([
        c.id,
        b.id,
        a.id,
      ]);
    });

    it("includes the owning app and searches by id, address, reference and customer", async () => {
      const customer = await createCustomer(appId, {
        name: "Grace Hopper",
        externalId: "u-grace",
      });
      const withCustomer = await createQuoteRow({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });
      await db
        .update(quoteTable)
        .set({ customerId: customer.id, reference: "order-77" })
        .where(eq(quoteTable.id, withCustomer.id));

      const target = await createTransferRow({ appId, quote: withCustomer });
      const other = await open();

      const ids = async (q: string) =>
        (await service.getTransfers({ appId, q })).data.map((t) => t.id);

      expect(await ids("order-77")).toEqual([target.id]);
      expect(await ids("grace")).toEqual([target.id]);
      expect(await ids("u-grace")).toEqual([target.id]);
      expect(await ids(target.id.slice(0, 8))).toEqual([target.id]);
      expect(await ids(other.payinAddress.slice(2, 12))).toEqual([other.id]);
      expect(await ids("nothing-matches")).toEqual([]);

      const [first] = (await service.getTransfers({ appId })).data;
      expect(first.app).toMatchObject({ id: appId });
    });

    it("lists deposits by address", async () => {
      const row = await open();
      await createDepositRow({
        address: row.payinAddress,
        chainId,
        tokenId: usdcId,
        sender: SENDER,
        amount: 5n,
      });

      expect(await service.getDepositsByAddress(row.payinAddress)).toHaveLength(
        1,
      );
    });
  });
});
