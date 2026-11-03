import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  appChain,
  chain,
  chainConfig,
  quote as quoteTable,
  quoteFee,
  token,
  transfer,
} from "../../db/schema";
import { createApp, createQuoteRowFor } from "./nearHelpers";
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

const service = new TransferService();

const CAIP2 = "near:mainnet" as Caip2Id;
const FACTORY = "kite-factory.near";
const USDC = "usdc.near";
const IMPLEMENTATION = "4reLvkAWfqk5fsqio1KLudk46cqRz9erQdaHkWZKMJDZ";
const SHOP = "shop.near";
const PAYER = "payer.near";

type Outcome = {
  logs: string[];
  executor?: string;
};

const outcome = (
  receipts: Outcome[],
  status: "success" | "failure" = "success",
) => ({
  status,
  transactionHash: "TxHash111",
  failure: status === "failure" ? "{}" : undefined,
  outcome: {
    transaction_outcome: { id: "TxHash111" },
    receipts_outcome: receipts.map((r, i) => ({
      id: `r${i}`,
      outcome: { logs: r.logs, executor_id: r.executor ?? FACTORY },
    })),
  },
});

const event = (name: string, data: Record<string, unknown>) =>
  `EVENT_JSON:${JSON.stringify({ standard: "kite", version: "1.0.0", event: name, data })}`;

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

    appId = (await createApp()).id;
    const [row] = await db.insert(chain).values({ caip2Id: CAIP2 }).returning();
    chainId = row.id;

    const [usdc] = await db
      .insert(token)
      .values({
        chainId,
        address: USDC,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        listed: true,
      })
      .returning();
    usdcId = usdc.id;

    const [near] = await db
      .insert(token)
      .values({
        chainId,
        address: "near",
        symbol: "NEAR",
        name: "NEAR",
        decimals: 24,
        listed: true,
      })
      .returning();
    nearId = near.id;

    await db.insert(chainConfig).values({
      chainId,
      slippageBps: 100,
      kiteFactoryAddress: FACTORY,
      usdPeggedTokenId: usdcId,
      settlementTokenId: usdcId,
      onchainNotifierProviders: [],
      gasSponsorProviders: [],
    });

    await db.insert(appChain).values({ appId, chainId, address: SHOP });

    // the factory's views, answered as the contract would
    fakeNearActor.view.mockImplementation(async (...args: unknown[]) => {
      const [, contractId, method, params] = args as [
        Caip2Id,
        string,
        string,
        { transfer?: NearKiteTransfer; account_id?: string },
      ];
      if (contractId === FACTORY && method === "implementation")
        return IMPLEMENTATION;
      if (contractId === FACTORY && method === "predict_address")
        return kiteNear.predictAddress(FACTORY, params.transfer!);
      if (contractId === FACTORY && method === "deploy_deposit")
        return "35000000000000000000000";
      if (method === "get_status") return "Open";
      if (method === "get_progress") return { wrapped: false };
      if (method === "storage_balance_of")
        return params.account_id === SHOP
          ? null
          : { total: "1", available: "0" };
      if (method === "storage_balance_bounds")
        return { min: "1250000000000000000000" };
      throw new Error(`unexpected view ${contractId}.${method}`);
    });
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
    it("creates the deposit account at the address the factory derives", async () => {
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

      expect(fakeNearActor.functionCall).toHaveBeenCalledWith(
        CAIP2,
        expect.objectContaining({
          contractId: FACTORY,
          method: "deploy",
          args: { transfer: struct },
          deposit: 35_000_000_000_000_000_000_000n,
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
        .set({ swapPool: `${USDC}|wrap.near|100` })
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
          router: "dclv2.ref-labs.near",
          pool: { Dcl: `${USDC}|wrap.near|100` },
          wrap: "wrap.near",
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

    it("fails when the deposit account can't be created", async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([], "failure"));

      await expect(
        service.createTransfer(appId, quote.id, PAYER),
      ).rejects.toThrow("Could not create the deposit account");
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

    it("doesn't count the account's own reserve as native payment", async () => {
      const quote = await createQuoteRowFor({
        appId,
        chainId,
        sourceTokenId: nearId,
        targetTokenId: nearId,
        sourceAmount: 10n ** 24n,
      });
      fakeNearActor.functionCall.mockResolvedValueOnce(outcome([]));
      const created = await service.createTransfer(appId, quote.id, PAYER);

      fakeNearActor.getBalance.mockResolvedValue(
        NearDepositReserve + 10n ** 24n - 1n,
      );
      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
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

      const row = await reload(created.id);
      expect(row.status).toBe(TransferStatus.Settled);
      expect(row.settlementBlockchainHash).toBe("TxHash111");
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

    it("retries a settlement that stopped after its swap", async () => {
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
                  step: "Pay",
                  status: "Executing",
                  reason: "PayoutFailed",
                }),
              ],
            },
          ]),
        );

      await expect(service.settleTransfer(created.id)).rejects.toBeInstanceOf(
        AppError,
      );
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
