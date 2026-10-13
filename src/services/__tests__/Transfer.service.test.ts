import {
  createApp,
  createConfiguredChain,
  createCustomer,
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
  operatorAddress,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import {
  chainConfig,
  deposit,
  event,
  operatorForward,
  quote as quoteTable,
  quoteFee,
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
import { TransferStatus, WebhookCategory } from "../../shared/constants";
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
  };

  beforeEach(async () => {
    resetMocks();
    vi.mocked(runProviderMethod).mockClear();
    spies.predict.mockImplementation(async (_client, _factory, struct) =>
      payinFor(common.bytes32ToUuid(struct.id)!),
    );
    spies.simulate.mockResolvedValue({ ok: true });
    spies.status.mockResolvedValue("Open");
    fakeActor.publicClient.mockResolvedValue({});

    appId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
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
        routerAddress: getChain(CAIP2).contracts.Uniswap.SwapRouter02,
        fees: [
          {
            id: common.uuidToBytes32(fee.id),
            recipient: address(0xfee),
            amount: "9000",
          },
        ],
      });
    });

    it("pays out to the configured settlement address", async () => {
      await db
        .update(chainConfig)
        .set({ settlementAddress: address(0x5e77) })
        .where(eq(chainConfig.chainId, chainId));

      const created = await service.createTransfer(
        appId,
        (await newQuote()).id,
        REFUND_TO,
      );
      expect(created.settlementRecipient).toBe(address(0x5e77));
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

      await service.refundTransfer(row.id);

      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to: FACTORY,
          data: kite.factory.refund(struct),
        }),
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

        await service.refundTransfer(row.id);
        expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
      },
    );

    it("reconciles when the transfer is already closed on-chain", async () => {
      const row = await open({ status: TransferStatus.Failed });
      spies.simulate.mockResolvedValue({
        ok: false,
        kind: "revert",
        errorName: "InvoiceNotOpen",
        message: "closed",
      });
      spies.status.mockResolvedValue("Refunded");

      await service.refundTransfer(row.id);
      expect((await reload(row.id)).status).toBe(TransferStatus.Refunded);
    });

    it("surfaces contract rejections so the job retries", async () => {
      const row = await open({ status: TransferStatus.Failed });
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

    it("re-queues refunds for failed transfers, except accepted x402 payments", async () => {
      const failed = await open({ status: TransferStatus.Failed });
      const held = await open({
        status: TransferStatus.Failed,
        x402SettledAt: new Date(),
      });
      const recent = await open({ status: TransferStatus.Failed });
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await db
        .update(transfer)
        .set({ updatedAt: old })
        .where(eq(transfer.id, failed.id));
      await db
        .update(transfer)
        .set({ updatedAt: old })
        .where(eq(transfer.id, held.id));

      await service.sweep();

      const queued = schedulerMock.enqueueRefund.mock.calls.map(
        (c) => (c as unknown[])[0],
      );
      expect(queued).toEqual([failed.id]);
      expect(queued).not.toContain(recent.id);
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
