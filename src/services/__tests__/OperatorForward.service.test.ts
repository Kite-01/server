import {
  createApp,
  createConfiguredChain,
  createToken,
  address,
  USDC,
  ZERO,
} from "../../test/factories";
import {
  createDepositRow,
  createQuoteRow,
  createTransferRow,
  payinFor,
} from "../../test/transfers";
import {
  OperatorForwardKind,
  OperatorForwardStatus,
} from "../../shared/constants";
import {
  OperatorTransactionFailedError,
  NotFoundError,
} from "../../shared/errors";
import {
  fakeActor,
  operatorAddress,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { OperatorForwardService } from "../OperatorForward.service";
import { operatorForward } from "../../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const service = new OperatorForwardService();

const SENDER = address(0x5e1);
const OTHER_SENDER = address(0x5e2);
const PAYER = address(0x9a7);

describe("OperatorForwardService", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;

  beforeEach(async () => {
    resetMocks();
    appId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    usdcId = configured.usdc.id;
  });

  const open = async (
    values: Partial<Parameters<typeof createTransferRow>[0]> = {},
  ) => {
    const quote = await createQuoteRow({
      appId,
      chainId,
      sourceTokenId: usdcId,
      targetTokenId: usdcId,
    });

    const row = await createTransferRow({
      appId,
      quote,
      refundAddress: operatorAddress,
      ...values,
    });

    return { ...row, quote: { ...quote, sourceToken: { address: USDC } } };
  };

  const base = (transferRow: Awaited<ReturnType<typeof open>>) => ({
    caip2Id: "eip155:8453" as Caip2Id,
    payinAddress: transferRow.payinAddress,
    blockchainHash: `0x${"ab".repeat(32)}`,
    logIndex: "3",
  });

  const record = (
    transferRow: Awaited<ReturnType<typeof open>>,
    item: OnchainNotifierCallbackResultItem,
    sourceId = "source-1",
  ) =>
    db.transaction((tx) =>
      service.recordForward(tx, { transfer: transferRow, item, sourceId }),
    );

  const forwards = () => db.select().from(operatorForward);

  const refunded = (
    transferRow: Awaited<ReturnType<typeof open>>,
    overrides: Partial<{ amountRefunded: bigint; refundAddress: string }> = {},
  ): OnchainNotifierCallbackResultItem => ({
    ...base(transferRow),
    type: "Refunded",
    transferId: "0x",
    amountRefunded: 1_000_000n,
    refundAddress: operatorAddress,
    ...overrides,
  });

  describe("recordForward", () => {
    it("ignores transfers that were not refunded to the operator", async () => {
      const row = await open({ refundAddress: address(0x1234) });

      await record(row, refunded(row));
      expect(await forwards()).toHaveLength(0);
    });

    it("ignores funds that did not land in the operator wallet", async () => {
      const row = await open();

      await record(row, refunded(row, { refundAddress: address(0x1234) }));
      await record(row, refunded(row, { amountRefunded: 0n }), "source-2");
      expect(await forwards()).toHaveLength(0);
    });

    it("sends a refund back to the only sender and queues the payout", async () => {
      const row = await open();
      await createDepositRow({
        address: row.payinAddress,
        chainId,
        tokenId: usdcId,
        sender: SENDER,
        amount: 1_000_000n,
      });

      await record(row, refunded(row));

      const [forward] = await forwards();
      expect(forward).toMatchObject({
        transferId: row.id,
        kind: OperatorForwardKind.Refund,
        status: OperatorForwardStatus.Pending,
        recipient: SENDER,
        amount: 1_000_000n,
        tokenId: usdcId,
        reason: null,
      });
      expect(schedulerMock.enqueueForward).toHaveBeenCalledWith(
        forward.id,
        expect.anything(),
      );
    });

    it("sums several deposits from the same sender", async () => {
      const row = await open();
      for (const amount of [400_000n, 600_000n]) {
        await createDepositRow({
          address: row.payinAddress,
          chainId,
          tokenId: usdcId,
          sender: SENDER,
          amount,
        });
      }

      await record(row, refunded(row));
      expect((await forwards())[0]).toMatchObject({
        status: OperatorForwardStatus.Pending,
        recipient: SENDER,
      });
    });

    it("holds the funds when more than one address paid in", async () => {
      const row = await open();
      for (const sender of [SENDER, OTHER_SENDER]) {
        await createDepositRow({
          address: row.payinAddress,
          chainId,
          tokenId: usdcId,
          sender,
          amount: 500_000n,
        });
      }

      await record(row, refunded(row));

      expect((await forwards())[0]).toMatchObject({
        status: OperatorForwardStatus.Held,
        recipient: null,
        reason: "The funds came from more than one sender",
      });
      expect(schedulerMock.enqueueForward).not.toHaveBeenCalled();
    });

    it("only looks at deposits made to this transfer's address", async () => {
      const row = await open({ x402Payer: PAYER });
      const unrelated = await open();

      await createDepositRow({
        address: unrelated.payinAddress,
        chainId,
        tokenId: usdcId,
        sender: OTHER_SENDER,
        amount: 1_000_000n,
      });

      await record(row, refunded(row));

      expect((await forwards())[0]).toMatchObject({
        transferId: row.id,
        status: OperatorForwardStatus.Pending,
        recipient: PAYER,
      });
    });

    it("falls back to the x402 payer when no deposit is on record", async () => {
      const row = await open({ x402Payer: PAYER });

      await record(row, refunded(row));
      expect((await forwards())[0]).toMatchObject({
        status: OperatorForwardStatus.Pending,
        recipient: PAYER,
      });
    });

    it("holds when there is no deposit and no payer", async () => {
      const row = await open();

      await record(row, refunded(row));
      expect((await forwards())[0]).toMatchObject({
        status: OperatorForwardStatus.Held,
        reason: "No deposit is on record for these funds",
      });
    });

    it("holds a refund once the x402 payment was accepted", async () => {
      const row = await open({
        x402Payer: PAYER,
        x402SettledAt: new Date(),
      });

      await record(row, refunded(row));
      expect((await forwards())[0]).toMatchObject({
        status: OperatorForwardStatus.Held,
        recipient: null,
      });
    });

    it("holds recovered pay-in tokens", async () => {
      const row = await open();
      await createDepositRow({
        address: row.payinAddress,
        chainId,
        tokenId: usdcId,
        sender: SENDER,
        amount: 1_000_000n,
      });

      await record(row, {
        ...base(row),
        type: "Recovered",
        transferId: "0x",
        tokenAddress: USDC,
        amount: 5n,
        to: operatorAddress,
      });

      expect((await forwards())[0]).toMatchObject({
        kind: OperatorForwardKind.Recovery,
        status: OperatorForwardStatus.Held,
      });
    });

    it("returns an excess to the sender of a token other than the pay-in token", async () => {
      const row = await open();
      const dai = await createToken(chainId, { symbol: "DAI" });
      await createDepositRow({
        address: row.payinAddress,
        chainId,
        tokenId: dai.id,
        sender: SENDER,
        amount: 7n,
      });

      await record(row, {
        ...base(row),
        type: "ExcessRefunded",
        transferId: "0x",
        tokenAddress: dai.address,
        amount: 7n,
        to: operatorAddress,
      });

      expect((await forwards())[0]).toMatchObject({
        kind: OperatorForwardKind.Excess,
        status: OperatorForwardStatus.Pending,
        recipient: SENDER,
        tokenId: dai.id,
        amount: 7n,
      });
    });

    it("pays an overpayment excess back to the x402 payer", async () => {
      const row = await open({ x402Payer: PAYER });
      await createDepositRow({
        address: row.payinAddress,
        chainId,
        tokenId: usdcId,
        sender: PAYER,
        amount: 1_300_000n,
      });

      await record(row, {
        ...base(row),
        type: "ExcessRefunded",
        transferId: "0x",
        tokenAddress: USDC,
        amount: 300_000n,
        to: operatorAddress,
      });

      expect((await forwards())[0]).toMatchObject({
        kind: OperatorForwardKind.Excess,
        status: OperatorForwardStatus.Pending,
        recipient: PAYER,
      });
    });

    it("records a payout once per source event", async () => {
      const row = await open({ x402Payer: PAYER });

      await record(row, refunded(row), "same-source");
      await record(row, refunded(row), "same-source");

      expect(await forwards()).toHaveLength(1);
      expect(schedulerMock.enqueueForward).toHaveBeenCalledTimes(1);
    });

    it("fails loudly for a token the system does not know", async () => {
      const row = await open();

      await expect(
        record(row, {
          ...base(row),
          type: "ExcessRefunded",
          transferId: "0x",
          tokenAddress: address(0xdead),
          amount: 1n,
          to: operatorAddress,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("processForward", () => {
    const pending = async (
      overrides: Partial<typeof operatorForward.$inferInsert> = {},
    ) => {
      const row = await open({ x402Payer: PAYER });
      const [forward] = await db
        .insert(operatorForward)
        .values({
          transferId: row.id,
          sourceId: `s-${crypto.randomUUID()}`,
          sourceBlockchainHash: `0x${"cd".repeat(32)}`,
          kind: OperatorForwardKind.Refund,
          tokenId: usdcId,
          amount: 250_000n,
          recipient: PAYER,
          status: OperatorForwardStatus.Pending,
          ...overrides,
        })
        .returning();

      return forward;
    };

    const reload = async (id: string) => {
      const [row] = await db
        .select()
        .from(operatorForward)
        .where(eq(operatorForward.id, id));
      return row;
    };

    it("sends the tokens and marks the payout sent", async () => {
      const forward = await pending();
      fakeActor.sendTransaction.mockImplementation(
        async (...args: unknown[]) => {
          const hooks = args[2] as {
            onSubmitted: (id: string) => Promise<void>;
          };
          await hooks.onSubmitted("call-9");
          return "0xpaid";
        },
      );

      await service.processForward(forward.id);

      const sent = fakeActor.sendTransaction.mock.calls[0][0] as {
        to: string;
        value: bigint;
        data: string;
      };
      expect(sent.to).toBe(USDC);
      expect(sent.value).toBe(0n);
      expect(sent.data.startsWith("0xa9059cbb")).toBe(true);
      expect(sent.data.toLowerCase()).toContain(PAYER.slice(2).toLowerCase());

      expect(await reload(forward.id)).toMatchObject({
        status: OperatorForwardStatus.Sent,
        blockchainHash: "0xpaid",
        callId: "call-9",
      });
    });

    it("sends native currency as a value transfer", async () => {
      const native = await createToken(chainId, {
        address: ZERO,
        symbol: "ETH",
      });
      const forward = await pending({ tokenId: native.id, amount: 5n });

      await service.processForward(forward.id);

      expect(fakeActor.sendTransaction.mock.calls[0][0]).toMatchObject({
        to: PAYER,
        value: 5n,
        data: undefined,
      });
    });

    it("waits for confirmations before sending anything", async () => {
      const forward = await pending();
      fakeActor.getConfirmations.mockResolvedValue(1n);

      await expect(service.processForward(forward.id)).rejects.toThrow(
        /Waiting for confirmation/,
      );
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
      expect((await reload(forward.id)).status).toBe(
        OperatorForwardStatus.Pending,
      );
    });

    it("leaves held payouts alone", async () => {
      const forward = await pending({
        status: OperatorForwardStatus.Held,
        recipient: null,
      });

      await service.processForward(forward.id);
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("marks the payout failed when the operator transaction fails", async () => {
      const forward = await pending();
      fakeActor.sendTransaction.mockRejectedValue(
        new OperatorTransactionFailedError("call-1"),
      );

      await service.processForward(forward.id);

      expect(await reload(forward.id)).toMatchObject({
        status: OperatorForwardStatus.Failed,
        error: "Operator transaction failed",
      });
    });

    it("keeps the payout submitted when the outcome is unknown, then resolves it without resending", async () => {
      const forward = await pending();
      fakeActor.sendTransaction.mockImplementation(
        async (...args: unknown[]) => {
          const hooks = args[2] as {
            onSubmitted: (id: string) => Promise<void>;
          };
          await hooks.onSubmitted("call-7");
          throw new Error("rpc timeout");
        },
      );

      await expect(service.processForward(forward.id)).rejects.toThrow(
        "rpc timeout",
      );
      expect(await reload(forward.id)).toMatchObject({
        status: OperatorForwardStatus.Submitted,
        callId: "call-7",
      });

      fakeActor.sendTransaction.mockClear();
      fakeActor.getTransactionStatus.mockResolvedValue({
        status: "success",
        transactionHash: "0xlanded",
      });

      await service.processForward(forward.id);

      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
      expect(await reload(forward.id)).toMatchObject({
        status: OperatorForwardStatus.Sent,
        blockchainHash: "0xlanded",
      });
    });

    it("does not resend while a submitted payout is still pending", async () => {
      const forward = await pending({
        status: OperatorForwardStatus.Submitted,
        callId: "call-2",
      });
      fakeActor.getTransactionStatus.mockResolvedValue({ status: "pending" });

      await expect(service.processForward(forward.id)).rejects.toThrow(
        "Payout is still pending",
      );
      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("resends only after the earlier call failed on-chain", async () => {
      const forward = await pending({
        status: OperatorForwardStatus.Submitted,
        callId: "call-3",
      });
      fakeActor.getTransactionStatus.mockResolvedValue({ status: "failed" });

      await service.processForward(forward.id);

      expect(fakeActor.sendTransaction).toHaveBeenCalledTimes(1);
      expect((await reload(forward.id)).status).toBe(
        OperatorForwardStatus.Sent,
      );
    });

    it("fails a submitted payout that has no call id instead of guessing", async () => {
      const forward = await pending({
        status: OperatorForwardStatus.Submitted,
        callId: null,
      });

      await service.processForward(forward.id);

      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
      expect((await reload(forward.id)).status).toBe(
        OperatorForwardStatus.Failed,
      );
    });

    it("pays out once when processed concurrently", async () => {
      const forward = await pending();

      await Promise.all([
        service.processForward(forward.id),
        service.processForward(forward.id),
      ]);

      expect(fakeActor.sendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("requeueStuck", () => {
    it("requeues payouts that have not moved for two minutes", async () => {
      const row = await open();
      const insert = (status: OperatorForwardStatus, minutesOld: number) =>
        db
          .insert(operatorForward)
          .values({
            transferId: row.id,
            sourceId: `s-${crypto.randomUUID()}`,
            sourceBlockchainHash: "0x1",
            kind: OperatorForwardKind.Refund,
            tokenId: usdcId,
            amount: 1n,
            recipient: PAYER,
            status,
            updatedAt: new Date(Date.now() - minutesOld * 60 * 1000),
          })
          .returning({ id: operatorForward.id })
          .then(([r]) => r.id);

      const stale = await insert(OperatorForwardStatus.Pending, 5);
      const staleSubmitted = await insert(OperatorForwardStatus.Submitted, 5);
      await insert(OperatorForwardStatus.Pending, 0);
      await insert(OperatorForwardStatus.Sent, 5);
      await insert(OperatorForwardStatus.Held, 5);

      await service.requeueStuck();

      const queued = schedulerMock.enqueueForward.mock.calls.map(
        (c) => (c as unknown[])[0],
      );
      expect(queued.sort()).toEqual([stale, staleSubmitted].sort());
    });
  });
});

void payinFor;
