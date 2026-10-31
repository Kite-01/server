import {
  acceptChain,
  address,
  createApp,
  createConfiguredChain,
} from "../../test/factories";
import { createQuoteRow, createTransferRow } from "../../test/transfers";
import {
  nearIntentsMock,
  operatorAddress,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { PayoutStatus, TransferStatus } from "../../shared/constants";
import { payout, transferTimeline } from "../../db/schema";
import { PayoutService } from "../Payout.service";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const service = new PayoutService();
const DEPOSIT = address(0xde90);

describe("PayoutService", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;

  beforeEach(async () => {
    resetMocks();
    appId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    usdcId = configured.usdc.id;
    await acceptChain(appId, chainId);
  });

  const paidOut = async (
    values: {
      status?: TransferStatus;
      payoutStatus?: PayoutStatus;
      deadline?: Date;
    } = {},
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
      status: values.status ?? TransferStatus.Settled,
    });

    await db.insert(payout).values({
      transferId: row.id,
      depositAddress: DEPOSIT,
      destinationAsset: "nep141:usdc.near",
      destinationSymbol: "USDC",
      destinationChain: "near",
      recipient: "shop.near",
      refundTo: operatorAddress,
      deadline: values.deadline ?? new Date(Date.now() + 86_400_000),
      status: values.payoutStatus ?? PayoutStatus.Pending,
      quote: {},
    });

    return row;
  };

  const payoutOf = async (transferId: string) => {
    const [row] = await db
      .select()
      .from(payout)
      .where(eq(payout.transferId, transferId));
    return row;
  };

  const timelineOf = async (transferId: string) => {
    const rows = await db
      .select()
      .from(transferTimeline)
      .where(eq(transferTimeline.transferId, transferId));
    return rows.map((row) => row.description);
  };

  describe("checkPayout", () => {
    it("records a delivered payout with its destination transaction", async () => {
      const row = await paidOut();
      nearIntentsMock.getStatus.mockResolvedValue({
        status: "SUCCESS",
        swapDetails: {
          amountOut: "998000",
          amountOutFormatted: "0.998",
          destinationChainTxHashes: [
            {
              hash: "7xNear",
              explorerUrl: "https://nearblocks.io/txns/7xNear",
            },
          ],
        },
      });

      await service.checkPayout(row.id);

      expect(nearIntentsMock.getStatus).toHaveBeenCalledWith(
        DEPOSIT,
        expect.anything(),
      );
      expect(await payoutOf(row.id)).toMatchObject({
        status: PayoutStatus.Delivered,
        amountOut: 998_000n,
        blockchainHash: "7xNear",
        explorerUrl: "https://nearblocks.io/txns/7xNear",
      });
      expect(await timelineOf(row.id)).toEqual([
        "Paid out 0.998 USDC on near to shop.near",
      ]);
    });

    it("records a refund to the app's address on the paying chain", async () => {
      const row = await paidOut();
      nearIntentsMock.getStatus.mockResolvedValue({
        status: "REFUNDED",
        swapDetails: {
          refundedAmount: "999000",
          refundedAmountFormatted: "0.999",
          refundReason: "PARTIAL_DEPOSIT",
        },
      });

      await service.checkPayout(row.id);

      expect(await payoutOf(row.id)).toMatchObject({
        status: PayoutStatus.Refunded,
        refundedAmount: 999_000n,
        reason: "PARTIAL_DEPOSIT",
      });
      expect(await timelineOf(row.id)).toEqual([
        `NEAR Intents refunded 0.999 to ${operatorAddress} (PARTIAL_DEPOSIT)`,
      ]);
    });

    it("marks a payout NEAR Intents is working on, without a timeline entry", async () => {
      const row = await paidOut();
      nearIntentsMock.getStatus.mockResolvedValue({ status: "PROCESSING" });

      await service.checkPayout(row.id);

      expect((await payoutOf(row.id)).status).toBe(PayoutStatus.Processing);
      expect(await timelineOf(row.id)).toEqual([]);
    });

    it("records a failure", async () => {
      const row = await paidOut();
      nearIntentsMock.getStatus.mockResolvedValue({ status: "FAILED" });

      await service.checkPayout(row.id);

      expect((await payoutOf(row.id)).status).toBe(PayoutStatus.Failed);
      expect(await timelineOf(row.id)).toEqual([
        "NEAR Intents couldn't pay out to shop.near",
      ]);
    });

    it("leaves a finished payout alone", async () => {
      const row = await paidOut({ payoutStatus: PayoutStatus.Delivered });

      await service.checkPayout(row.id);

      expect(nearIntentsMock.getStatus).not.toHaveBeenCalled();
    });
  });

  describe("requeueUnfinished", () => {
    it("checks unfinished payouts of settled transfers until an hour past their deadline", async () => {
      const waiting = await paidOut();
      const working = await paidOut({ payoutStatus: PayoutStatus.Processing });
      await paidOut({ payoutStatus: PayoutStatus.Delivered });
      await paidOut({ status: TransferStatus.AwaitingDeposit });
      await paidOut({ deadline: new Date(Date.now() - 2 * 3_600_000) });

      await service.requeueUnfinished();

      expect(
        schedulerMock.enqueueCheckPayout.mock.calls
          .map((call) => (call as unknown[])[0])
          .sort(),
      ).toEqual([waiting.id, working.id].sort());
    });
  });
});
