import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { quote as quoteTable, quoteFee, transfer } from "../../db/schema";
import {
  NEAR_CAIP2 as CAIP2,
  NEAR_FACTORY as FACTORY,
  NEAR_IMPLEMENTATION as IMPLEMENTATION,
  NEAR_SHOP as SHOP,
  NEAR_USDC as USDC,
  createNearQuoteRow as createQuoteRowFor,
  nearDeployedAccount as deployed,
  nearEvent as event,
  nearOutcome as outcome,
  setupNearChain,
} from "../../test/near";
import { createPaymentLink } from "../../test/factories";
import {
  fakeNearActor,
  nearOperator,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import { TransferStatus } from "../../shared/constants";
import {
  kiteNear,
  NearDepositReserve,
  type NearKiteTransfer,
} from "../../shared/kiteNearContract";
import { TransferService } from "../Transfer.service";
import { AppError } from "../../shared/errors";
import { client, rootCredentials } from "../../test/api";

const service = new TransferService();
const PAYER = "payer.near";

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

describe("TransferService on NEAR", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;
  let nearId: string;

  beforeEach(async () => {
    resetMocks();
    ({ appId, chainId, usdcId, nearId } = await setupNearChain());
  });

  const create = async (
    values: Parameters<typeof createQuoteRowFor>[0] extends infer T
      ? Partial<T>
      : never = {},
  ) => {
    const quote = await createQuoteRowFor({
      appId,
      chainId,
      sourceTokenId: usdcId,
      targetTokenId: usdcId,
      ...values,
    });
    fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));
    return service.createTransfer(appId, quote.id, PAYER);
  };

  describe("createTransfer", () => {
    it("registers the account the factory derives on the pay-in token, without deploying it", async () => {
      const created = await create({ sourceAmount: 2_000_000n });
      const struct = created.kiteTransferInput as unknown as NearKiteTransfer;

      expect(created.payinAddress).toMatch(/^0s[0-9a-f]{40}$/);
      expect(created.payinAddress).toBe(
        kiteNear.predictAddress(FACTORY, struct),
      );
      expect(created.paymentInstructions).toMatchObject({
        caip2Id: CAIP2,
        address: created.payinAddress,
        tokenAddress: USDC,
        amount: "2000000",
      });
      expect(struct).toMatchObject({
        id: created.id,
        pay_in: { Token: USDC },
        settlement_token: { Token: USDC },
        settlement_recipient: SHOP,
        refund_account: PAYER,
        min_amount_out: "1980000",
        swap: null,
        implementation: IMPLEMENTATION,
      });

      expect(fakeNearActor.functionCall).toHaveBeenCalledTimes(1);
      expect(fakeNearActor.functionCall).toHaveBeenCalledWith(
        CAIP2,
        expect.objectContaining({
          contractId: FACTORY,
          method: "register",
          args: { transfer: struct },
          deposit: 1_250_000_000_000_000_000_000n,
        }),
        [],
      );
      expect((await reload(created.id)).trackedBy).toEqual([]);
    });

    it("swaps a different pay-in token through the quote's Rhea pool", async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: nearId,
        targetTokenId: usdcId,
        sourceAmount: 10n ** 24n,
        targetAmount: 3_000_000n,
      });
      await db
        .update(quoteTable)
        .set({ swapPool: `${USDC}|wrap.testnet|100` })
        .where(eq(quoteTable.id, quote.id));
      await db.insert(quoteFee).values({
        quoteId: quote.id,
        label: "platform",
        amount: 9_000n,
        feeAddress: nearOperator,
      });
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));

      const created = await service.createTransfer(appId, quote.id, PAYER);

      expect(created.kiteTransferInput).toMatchObject({
        pay_in: "Native",
        swap: {
          router: "dclv2.ref-dev.testnet",
          pool: { Dcl: `${USDC}|wrap.testnet|100` },
          wrap: "wrap.testnet",
        },
        fees: [{ recipient: nearOperator, amount: "9000" }],
      });
    });

    it("refuses a refund address that isn't a NEAR account", async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });

      await expect(
        service.createTransfer(appId, quote.id, "Payer.NEAR"),
      ).rejects.toThrow("The refund address is not a valid address");
    });

    it("sends nothing on-chain for a native NEAR transfer", async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: nearId,
        targetTokenId: nearId,
        sourceAmount: 10n ** 24n,
      });

      const created = await service.createTransfer(appId, quote.id, PAYER);

      expect(created.payinAddress).toMatch(/^0s[0-9a-f]{40}$/);
      expect(fakeNearActor.functionCall).not.toHaveBeenCalled();
    });

    it("fails when the deposit account can't be registered", async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([], "failure"));

      await expect(
        service.createTransfer(appId, quote.id, PAYER),
      ).rejects.toThrow("Could not register the deposit account on usdc.near");
    });
  });

  describe("through the API", () => {
    it("returns a NEAR transfer under the strict response model", async () => {
      const created = await create();
      const api = client(rootCredentials(appId));

      const res = await api.get(`/api/transfers/${created.id}`);

      expect(res.status).toBe(200);
      expect(res.json.kiteTransferInput).toMatchObject({
        pay_in: { Token: USDC },
        settlement_recipient: SHOP,
        swap: null,
      });
    });

    it("opens a NEAR transfer from a checkout", async () => {
      const link = await createPaymentLink(appId, {});
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });
      await db
        .update(quoteTable)
        .set({ paymentLinkId: link.id })
        .where(eq(quoteTable.id, quote.id));
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));

      const res = await client(rootCredentials()).post(
        `/api/checkout/${link.id}/transfer`,
        { quoteId: quote.id, refundAddress: PAYER },
      );

      expect(res.status).toBe(201);
      expect(res.json.payinAddress).toMatch(/^0s[0-9a-f]{40}$/);
      expect(res.json.paymentInstructions).toMatchObject({
        caip2Id: CAIP2,
        tokenAddress: USDC,
      });
    });
  });

  describe("settleTransfer", () => {
    it("waits while the deposit is short", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(999_999n);

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
      expect(fakeNearActor.functionCall).toHaveBeenCalledTimes(1);
    });

    const nativeTransfer = async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: nearId,
        targetTokenId: nearId,
        sourceAmount: 10n ** 24n,
      });
      return service.createTransfer(appId, quote.id, PAYER);
    };

    it("doesn't count the account's own reserve as native payment", async () => {
      const created = await nativeTransfer();

      fakeNearActor.getAccount.mockResolvedValue(
        deployed(NearDepositReserve + 10n ** 24n - 1n),
      );
      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
    });

    it("doesn't count the storage stake of a large state as native payment", async () => {
      const created = await nativeTransfer();
      const stake = 1_131n * 10n ** 19n;

      fakeNearActor.getAccount.mockResolvedValue(
        deployed(NearDepositReserve + stake + 10n ** 24n - 1n, 1_131),
      );
      await service.settleTransfer(created.id);
      expect((await reload(created.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );

      fakeNearActor.getAccount.mockResolvedValue(
        deployed(NearDepositReserve + stake + 10n ** 24n, 1_131),
      );
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));
      await service.settleTransfer(created.id);
      expect(
        fakeNearActor.functionCall.mock.calls.map(([, call]) => call),
      ).toContainEqual(expect.objectContaining({ method: "settle" }));
    });

    it("registers the recipients, settles, and records the result", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(1_000_000n);
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(
          outcome([
            {
              executor: created.payinAddress,
              logs: [
                event("settled", {
                  transfer_id: created.id,
                  settlement_recipient: SHOP,
                  settlement_token: { Token: USDC },
                  pay_in: { Token: USDC },
                  amount_in: "1000000",
                  amount_out: "1000000",
                  fee_amount: "0",
                }),
              ],
            },
          ]),
        );

      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));

      await service.settleTransfer(created.id);

      const calls = fakeNearActor.functionCall.mock.calls.slice(1);
      expect(calls[0][1]).toEqual([
        expect.objectContaining({
          contractId: USDC,
          method: "storage_deposit",
          args: { account_id: SHOP, registration_only: true },
          deposit: 1_250_000_000_000_000_000_000n,
        }),
      ]);
      expect(calls[1][1]).toMatchObject({
        contractId: FACTORY,
        method: "settle",
      });
      expect(calls[2][1]).toMatchObject({
        contractId: FACTORY,
        method: "close",
      });

      const row = await reload(created.id);
      expect(row.status).toBe(TransferStatus.Settled);
      expect(row.settlementBlockchainHash).toBe("TxHash111");
    });

    it("deploys the account once the payment is in, then settles", async () => {
      const created = await create();
      fakeNearActor.getAccount.mockResolvedValue(null);
      fakeNearActor.getBalance.mockResolvedValue(1_000_000n);
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(
          outcome([
            {
              executor: created.payinAddress,
              logs: [event("settled", { transfer_id: created.id })],
            },
          ]),
        )
        .mockResolvedValueOnce(outcome([]));

      await service.settleTransfer(created.id);

      const methods = fakeNearActor.functionCall.mock.calls
        .slice(1)
        .map(([, call]) => (Array.isArray(call) ? call[0] : call).method);
      expect(methods).toEqual(["deploy", "storage_deposit", "settle", "close"]);
      expect(fakeNearActor.functionCall.mock.calls[1][1]).toMatchObject({
        contractId: FACTORY,
        deposit: 6_000_000_000_000_000_000_000n,
      });
      expect((await reload(created.id)).status).toBe(TransferStatus.Settled);
    });

    it("counts all of a plain account's NEAR, paid before the contract is deployed", async () => {
      const created = await nativeTransfer();
      fakeNearActor.getAccount.mockResolvedValue({
        amount: 10n ** 24n,
        storageUsage: 100,
        contract: null,
      });
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(
          outcome([
            {
              executor: created.payinAddress,
              logs: [event("settled", { transfer_id: created.id })],
            },
          ]),
        )
        .mockResolvedValueOnce(outcome([]));

      await service.settleTransfer(created.id);

      expect(
        fakeNearActor.functionCall.mock.calls.map(([, call]) => call),
      ).toMatchObject([
        { method: "deploy" },
        { method: "settle" },
        { method: "close" },
      ]);
    });

    it("cancels an unpaid transfer at expiry without deploying anything", async () => {
      const created = await create();
      fakeNearActor.getAccount.mockResolvedValue(null);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);

      await service
        .settleTransfer(created.id)
        .finally(() => vi.useRealTimers());

      expect((await reload(created.id)).status).toBe(TransferStatus.Cancelled);
      expect(fakeNearActor.functionCall).toHaveBeenCalledTimes(1);
    });

    it("fails and refunds when the swap fails", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(1_000_000n);
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(
          outcome([
            {
              executor: created.payinAddress,
              logs: [
                event("settle_stopped", {
                  transfer_id: created.id,
                  step: "Swap",
                  status: "Open",
                  reason: "SwapFailed",
                }),
              ],
            },
          ]),
        );

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(
        created.id,
        expect.anything(),
      );
    });

    const stopped = (transferId: string, payinAddress: string) =>
      outcome([
        {
          executor: payinAddress,
          logs: [
            event("settle_stopped", {
              transfer_id: transferId,
              step: "Pay",
              status: "Executing",
              reason: "OutOfGas",
            }),
          ],
        },
      ]);

    it("resumes a settlement that stopped after its swap", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(1_000_000n);
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(stopped(created.id, created.payinAddress))
        .mockResolvedValueOnce(
          outcome([
            {
              executor: created.payinAddress,
              logs: [event("settled", { transfer_id: created.id })],
            },
          ]),
        );

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(TransferStatus.Settled);
    });

    it("leaves a settlement that keeps stopping to the next attempt", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(1_000_000n);
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValue(stopped(created.id, created.payinAddress));

      await expect(service.settleTransfer(created.id)).rejects.toBeInstanceOf(
        AppError,
      );
      expect(fakeNearActor.functionCall).toHaveBeenCalledTimes(5);
      expect((await reload(created.id)).status).toBe(TransferStatus.Processing);
    });

    it("marks a transfer settled on-chain as settled", async () => {
      const created = await create();
      fakeNearActor.view.mockImplementation(async (...args: unknown[]) =>
        args[2] === "get_status" ? "Settled" : null,
      );

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(TransferStatus.Settled);
    });
  });

  describe("refundTransfer", () => {
    it("refunds through the factory and records it", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(700n);
      fakeNearActor.functionCall.mockResolvedValueOnce(
        outcome([
          {
            executor: created.payinAddress,
            logs: [
              event("refunded", {
                transfer_id: created.id,
                refund_account: PAYER,
                pay_in: { Token: USDC },
                amount_refunded: "700",
              }),
            ],
          },
        ]),
      );

      expect(await service.refundTransfer(created.id)).toEqual({
        refunded: true,
      });
      expect(fakeNearActor.functionCall.mock.calls[1][1]).toMatchObject({
        contractId: FACTORY,
        method: "refund",
      });
      expect((await reload(created.id)).status).toBe(TransferStatus.Refunded);
    });

    it("deploys an account that was paid but never deployed, then refunds", async () => {
      const created = await create();
      fakeNearActor.getAccount.mockResolvedValue(null);
      fakeNearActor.getBalance.mockResolvedValue(700n);
      fakeNearActor.functionCall
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(outcome([]))
        .mockResolvedValueOnce(outcome([]));

      expect(await service.refundTransfer(created.id)).toEqual({
        refunded: true,
      });
      expect(
        fakeNearActor.functionCall.mock.calls.slice(1).map(([, call]) => call),
      ).toMatchObject([
        { method: "deploy" },
        { method: "refund" },
        { method: "close" },
      ]);
    });

    it("has nothing to refund from an empty account", async () => {
      const created = await create();

      expect(await service.refundTransfer(created.id)).toMatchObject({
        refunded: false,
        reason: expect.stringContaining("nothing to refund"),
      });
    });
  });

  describe("recover", () => {
    it("won't recover the transfer's own token while it's open", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(5n);

      await expect(service.recover(created.id, USDC, PAYER)).rejects.toThrow(
        "transfer's own token",
      );
    });

    it("recovers another token to a destination", async () => {
      const created = await create();
      fakeNearActor.getBalance.mockResolvedValue(5n);
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));

      await service.recover(created.id, "other.near", "ops.near");

      expect(fakeNearActor.functionCall.mock.calls[1][1]).toMatchObject({
        contractId: FACTORY,
        method: "recover",
        args: { token: "other.near", destination: "ops.near" },
      });
    });
  });
});
