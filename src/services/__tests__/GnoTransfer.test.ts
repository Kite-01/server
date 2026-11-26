import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { app, quoteFee, transfer } from "../../db/schema";
import {
  GNO_CAIP2 as CAIP2,
  GNO_TUSD as TUSD,
  GNO_PAYER as PAYER,
  GNO_REALM as REALM,
  GNO_SHOP as SHOP,
  createGnoQuoteRow,
  gnoEvent,
  gnoResult,
  setupGnoChain,
} from "../../test/gno";
import {
  fakeGnoActor,
  nearIntentsMock,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import { TransferStatus } from "../../shared/constants";
import { kiteGno, type GnoKiteTransfer } from "../../shared/kiteGnoContract";
import { GnoCallError } from "../../sdks/GnoActor";
import { common } from "../../shared/common";
import { TransferService } from "../Transfer.service";

const service = new TransferService();
const KITE_FEE = "g1dd5hgetxv4j47h6lta047h6lta047h6lssult0";

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

describe("TransferService on Gno", () => {
  let appId: string;
  let chainId: string;
  let gnotId: string;
  let tusdId: string;

  beforeEach(async () => {
    resetMocks();
    ({ appId, chainId, gnotId, tusdId } = await setupGnoChain());
  });

  const create = async (
    values: Partial<Parameters<typeof createGnoQuoteRow>[0]> = {},
    refundAddress = PAYER,
  ) => {
    const quote = await createGnoQuoteRow({
      appId,
      chainId,
      sourceTokenId: gnotId,
      targetTokenId: gnotId,
      ...values,
    });
    return service.createTransfer(appId, quote.id, refundAddress);
  };

  const structOf = (created: { kiteTransferInput: unknown }) =>
    created.kiteTransferInput as GnoKiteTransfer;

  describe("createTransfer", () => {
    it("pays into the sub-realm address the realm derives", async () => {
      const created = await create();
      const struct = structOf(created);

      expect(created.payinAddress).toMatch(/^g1[a-z0-9]{38}$/);
      expect(created.payinAddress).toBe(kiteGno.predictAddress(REALM, struct));
      expect(struct).toMatchObject({
        id: created.id.replaceAll("-", ""),
        token: "ugnot",
        amount: "10000000",
        recipient: SHOP,
        refund: PAYER,
        fees: [],
      });
      expect(fakeGnoActor.evaluate).toHaveBeenCalledWith(
        CAIP2,
        REALM,
        `DepositAddress(${JSON.stringify(kiteGno.encode(struct))})`,
        expect.any(Array),
      );
      expect(fakeGnoActor.call).not.toHaveBeenCalled();
    });

    it("refuses a realm that derives another address", async () => {
      fakeGnoActor.evaluate.mockResolvedValue(PAYER);
      await expect(create()).rejects.toThrow(/The Kite realm derives/);
    });

    it("only takes the settlement token", async () => {
      await expect(create({ sourceTokenId: tusdId })).rejects.toThrow(
        /paid in the settlement token/,
      );
    });

    it("refuses an address from another chain", async () => {
      await expect(create({}, "payer.near")).rejects.toThrow(
        /not a valid address/,
      );
      await expect(create({}, REALM)).rejects.toThrow(/not a valid address/);
    });

    it("settles to the app's Gno address when a NEAR Intents payout is set", async () => {
      await db
        .update(app)
        .set({ payoutAsset: "nep141:usdc.near", payoutAddress: "shop.near" })
        .where(eq(app.id, appId));

      const created = await create();

      expect(created.settlementRecipient).toBe(SHOP);
      expect(structOf(created).recipient).toBe(SHOP);
      expect(nearIntentsMock.quote).not.toHaveBeenCalled();
    });
  });

  describe("settleTransfer", () => {
    it("waits for the deposit without calling the realm", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(9_999_999n);

      await service.settleTransfer(created.id);

      expect(fakeGnoActor.call).not.toHaveBeenCalled();
      expect((await reload(created.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
    });

    it("settles through the realm and follows its events", async () => {
      const created = await create();
      const id = created.id.replaceAll("-", "");
      fakeGnoActor.getBalance.mockResolvedValue(10_000_000n);
      fakeGnoActor.call.mockResolvedValue(
        gnoResult([
          gnoEvent("Settled", {
            transfer_id: id,
            deposit: created.payinAddress,
            to: SHOP,
            amount: "10000000",
          }),
        ]),
      );

      await service.settleTransfer(created.id);

      expect(fakeGnoActor.call).toHaveBeenCalledWith(
        CAIP2,
        REALM,
        "Settle",
        [kiteGno.encode(structOf(created))],
        expect.any(Array),
      );
      const row = await reload(created.id);
      expect(row.status).toBe(TransferStatus.Settled);
      expect(row.settlementBlockchainHash).toBe("GnoTxHash=");
    });

    it("records each fee by its position in the transfer", async () => {
      const created = await create();
      const fees = await db.query.quoteFee.findMany({
        where: eq(quoteFee.quoteId, created.quoteId),
      });
      expect(fees).toEqual([]);

      const items = kiteGno.parseEvents({
        caip2Id: CAIP2,
        realm: REALM,
        transactionHash: "hash",
        token: "ugnot",
        feeIds: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
        events: [
          gnoEvent("FeePaid", {
            transfer_id: created.id.replaceAll("-", ""),
            deposit: created.payinAddress,
            index: "1",
            to: KITE_FEE,
            amount: "5",
          }),
          { ...gnoEvent("Settled", {}), pkg_path: "gno.land/r/someone/else" },
        ],
      });
      expect(items).toEqual([
        expect.objectContaining({
          type: "FeePaid",
          payinAddress: created.payinAddress,
          feeId: common.uuidToBytes32("00000000-0000-4000-8000-000000000002"),
        }),
      ]);
    });

    it("retries while the realm can't see the deposit yet", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(10_000_000n);
      fakeGnoActor.call.mockRejectedValue(
        new GnoCallError("panic: kite: InsufficientPayment"),
      );

      await expect(service.settleTransfer(created.id)).rejects.toThrow(
        /Settlement failed/,
      );
      expect((await reload(created.id)).status).toBe(TransferStatus.Processing);
    });

    it("retries when the transaction fails for another reason", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(10_000_000n);
      fakeGnoActor.call.mockRejectedValue(new GnoCallError("out of gas"));

      await expect(service.settleTransfer(created.id)).rejects.toThrow(
        /out of gas/,
      );
    });

    it("fails and refunds a settlement the realm refuses", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(10_000_000n);
      fakeGnoActor.call.mockRejectedValue(
        new GnoCallError("panic: kite: Expired"),
      );

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(
        created.id,
        expect.anything(),
      );
    });

    it("follows a transfer the realm already closed", async () => {
      const created = await create();
      fakeGnoActor.evaluate.mockResolvedValue("Settled");

      await service.settleTransfer(created.id);

      expect(fakeGnoActor.call).not.toHaveBeenCalled();
      expect((await reload(created.id)).status).toBe(TransferStatus.Settled);
    });

    it("gives up on an underpaid transfer once it expires", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(1n);
      const later = Date.now() + 10 * 60 * 1000;
      vi.spyOn(Date, "now").mockReturnValue(later);

      try {
        await service.settleTransfer(created.id);
      } finally {
        vi.restoreAllMocks();
      }

      expect(fakeGnoActor.call).not.toHaveBeenCalled();
      expect((await reload(created.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalled();
    });
  });

  describe("refundTransfer", () => {
    it("refunds through the realm", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(10_000_000n);
      fakeGnoActor.call.mockResolvedValue(
        gnoResult([
          gnoEvent("Refunded", {
            transfer_id: created.id.replaceAll("-", ""),
            deposit: created.payinAddress,
            to: PAYER,
            amount: "10000000",
          }),
        ]),
      );

      expect(await service.refundTransfer(created.id)).toEqual({
        refunded: true,
      });
      expect(fakeGnoActor.call.mock.calls[0][2]).toBe("Refund");
      expect((await reload(created.id)).status).toBe(TransferStatus.Refunded);
    });

    it("says when there's nothing to refund", async () => {
      const created = await create();

      expect(await service.refundTransfer(created.id)).toEqual({
        refunded: false,
        reason: "There is nothing to refund: the pay-in address holds no GNOT",
      });
    });
  });

  describe("recoverToken", () => {
    it("recovers a stray token through the realm", async () => {
      const created = await create();
      fakeGnoActor.getBalance.mockResolvedValue(5n);
      fakeGnoActor.call.mockResolvedValue(gnoResult());

      expect(await service.getRecoveryBalance(created.id, TUSD)).toBe(5n);
      await service.recover(created.id, TUSD, PAYER);

      expect(fakeGnoActor.call).toHaveBeenCalledWith(
        CAIP2,
        REALM,
        "Recover",
        [kiteGno.encode(structOf(created)), TUSD, PAYER],
        expect.any(Array),
      );
    });
  });
});
