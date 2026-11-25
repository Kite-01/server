import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Address, nativeToScVal, Networks, xdr } from "@stellar/stellar-sdk";
import { db } from "../../db";
import {
  app,
  quoteFee,
  token,
  transfer,
  transferTimeline,
} from "../../db/schema";
import {
  STELLAR_CAIP2 as CAIP2,
  STELLAR_FACTORY as FACTORY,
  STELLAR_PAYER as PAYER,
  STELLAR_ROUTER as ROUTER,
  STELLAR_SHOP as SHOP,
  STELLAR_USDC as USDC,
  STELLAR_XLM as XLM,
  createStellarQuoteRow,
  kiteError,
  setupStellarChain,
  stellarEvent,
  stellarResult,
} from "../../test/stellar";
import {
  fakeStellarActor,
  resetMocks,
  schedulerMock,
  stellarOperator,
} from "../../test/mocks";
import { TransferStatus } from "../../shared/constants";
import {
  kiteStellar,
  type StellarKiteTransfer,
} from "../../shared/kiteStellarContract";
import { Chains, type StellarChain } from "../../shared/chains/registry";
import { common } from "../../shared/common";
import { TransferService } from "../Transfer.service";

const service = new TransferService();
const EXCHANGE =
  "MDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HYAAAAAAETFQC2JNVQ";

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

const withoutRouter = async (run: () => Promise<void>) => {
  const chain = Chains[CAIP2] as StellarChain;
  const soroswap = chain.contracts.Soroswap;
  delete chain.contracts.Soroswap;
  try {
    await run();
  } finally {
    chain.contracts.Soroswap = soroswap;
  }
};

describe("TransferService on Stellar", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;
  let xlmId: string;

  beforeEach(async () => {
    resetMocks();
    ({ appId, chainId, usdcId, xlmId } = await setupStellarChain());
  });

  const create = async (
    values: Partial<Parameters<typeof createStellarQuoteRow>[0]> = {},
    refundAddress = PAYER,
  ) => {
    const quote = await createStellarQuoteRow({
      appId,
      chainId,
      sourceTokenId: usdcId,
      targetTokenId: usdcId,
      ...values,
    });
    return service.createTransfer(appId, quote.id, refundAddress);
  };

  describe("createTransfer", () => {
    it("pays into the C… address the factory derives, with no swap and no router", async () => {
      await withoutRouter(async () => {
        const created = await create();
        const struct =
          created.kiteTransferInput as unknown as StellarKiteTransfer;

        expect(created.payinAddress).toMatch(/^C[A-Z2-7]{55}$/);
        expect(created.payinAddress).toBe(
          kiteStellar.predictAddress(FACTORY, struct, Networks.TESTNET),
        );
        expect(struct).toMatchObject({
          id: common.uuidToBytes32(created.id).slice(2),
          pay_in: USDC,
          settlement_token: USDC,
          settlement_recipient: SHOP,
          refund_address: PAYER,
          swap: null,
          implementation: "05".repeat(32),
        });
        expect(fakeStellarActor.invoke).not.toHaveBeenCalled();
      });
    });

    it("carries the Soroswap route when the customer pays in another token", async () => {
      const created = await create({
        sourceTokenId: xlmId,
        sourceAmount: 14_200_000n,
        targetAmount: 10_000_000n,
        swapPool: `${XLM},${USDC}`,
      });
      const struct =
        created.kiteTransferInput as unknown as StellarKiteTransfer;

      expect(struct.swap).toEqual({ router: ROUTER, path: [XLM, USDC] });
      // the slippage floor: 1% under the quoted output
      expect(struct.min_amount_out).toBe("9900000");
      expect(created.minAmountOut).toBe(9_900_000n);
    });

    it("refuses another token when no router is configured", async () => {
      await withoutRouter(async () => {
        await expect(
          create({
            sourceTokenId: xlmId,
            swapPool: `${XLM},${USDC}`,
          }),
        ).rejects.toThrow(/no swap route/);
      });
    });

    it("refunds to G…, C… and M… addresses", async () => {
      for (const address of [PAYER, FACTORY, EXCHANGE]) {
        const created = await create({}, address);
        expect(created.refundAddress).toBe(address);
      }
    });

    it("refuses an M… refund address for a token that isn't a SAC", async () => {
      fakeStellarActor.isSac.mockResolvedValue(false);

      await expect(create({}, EXCHANGE)).rejects.toThrow(/muxed address/);
      await expect(create({}, PAYER)).resolves.toBeTruthy();
    });

    it("refuses a refund address without a trustline for the token paid in", async () => {
      fakeStellarActor.canHold.mockResolvedValue(false);

      await expect(create({}, PAYER)).rejects.toThrow(
        "Can't refund to this address: " +
          `${PAYER} has no trustline for USDC on Stellar Testnet; add one first`,
      );
      expect(fakeStellarActor.canHold).toHaveBeenCalledWith(
        "stellar:testnet",
        expect.any(String),
        PAYER,
        expect.any(Array),
      );
    });

    it("refuses a refund account that was never funded", async () => {
      fakeStellarActor.accountExists.mockResolvedValue(false);

      await expect(create({}, PAYER)).rejects.toThrow(
        `${PAYER} isn't activated on Stellar Testnet; fund it with XLM first`,
      );
    });

    it("doesn't ask the operator, as the refund address, to be set up", async () => {
      fakeStellarActor.canHold.mockResolvedValue(false);
      fakeStellarActor.accountExists.mockResolvedValue(false);

      await expect(create({}, stellarOperator)).resolves.toBeTruthy();
    });

    it("settles to the app's address when its payout address can't hold the token", async () => {
      await db
        .update(token)
        .set({ nearIntentsAssetId: "nep141:stellar-usdc" })
        .where(eq(token.id, usdcId));
      await db
        .update(app)
        .set({ payoutAsset: "nep141:stellar-usdc", payoutAddress: PAYER })
        .where(eq(app.id, appId));
      fakeStellarActor.canHold.mockImplementation(
        async (...args: unknown[]) => args[2] !== PAYER,
      );

      const created = await create({}, SHOP);

      expect(created.settlementRecipient).toBe(SHOP);
    });

    it("refuses an address from another chain", async () => {
      await expect(create({}, "payer.near")).rejects.toThrow(
        /not a valid address/,
      );
    });
  });

  describe("settleTransfer", () => {
    it("waits for the deposit without calling the factory", async () => {
      const created = await create();
      fakeStellarActor.getBalance.mockResolvedValue(9_999_999n);

      await service.settleTransfer(created.id);

      expect(fakeStellarActor.invoke).not.toHaveBeenCalled();
      expect((await reload(created.id)).status).toBe(
        TransferStatus.AwaitingDeposit,
      );
    });

    it("settles through the factory and follows its events", async () => {
      const created = await create();
      fakeStellarActor.getBalance.mockResolvedValue(10_000_000n);
      fakeStellarActor.invoke.mockResolvedValue(
        stellarResult([
          stellarEvent(created.payinAddress, "settled", {
            transfer_id: xdr.ScVal.scvBytes(
              Buffer.from(common.uuidToBytes32(created.id).slice(2), "hex"),
            ),
            amount_out: nativeToScVal(10_000_000n, { type: "i128" }),
            recipient: Address.fromString(SHOP).toScVal(),
            amount: nativeToScVal(10_000_000n, { type: "i128" }),
          }),
        ]),
      );

      await service.settleTransfer(created.id);

      const [, contract, method, args] = fakeStellarActor.invoke.mock
        .calls[0] as [Caip2Id, string, string, xdr.ScVal[]];
      expect(contract).toBe(FACTORY);
      expect(method).toBe("settle");
      expect(Address.fromScVal(args[0]).toString()).toBe(stellarOperator);
      expect(args[1].toXDR("hex")).toBe(
        kiteStellar
          .toScVal(created.kiteTransferInput as unknown as StellarKiteTransfer)
          .toXDR("hex"),
      );

      const row = await reload(created.id);
      expect(row.status).toBe(TransferStatus.Settled);
      expect(row.settlementBlockchainHash).toBe("ab".repeat(32));
    });

    it("records each fee by its position in the transfer", async () => {
      const created = await create();
      const fees = await db.query.quoteFee.findMany({
        where: eq(quoteFee.quoteId, created.quoteId),
      });
      expect(fees).toEqual([]);

      const items = kiteStellar.parseEvents(
        CAIP2,
        "hash",
        [
          stellarEvent(created.payinAddress, "fee_paid", {
            transfer_id: xdr.ScVal.scvBytes(Buffer.alloc(32)),
            index: xdr.ScVal.scvU32(1),
            recipient: Address.fromString(SHOP).toScVal(),
            amount: nativeToScVal(5n, { type: "i128" }),
          }),
        ],
        [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
      );
      expect(items).toEqual([
        expect.objectContaining({
          type: "FeePaid",
          payinAddress: created.payinAddress,
          feeId: common.uuidToBytes32("00000000-0000-4000-8000-000000000002"),
        }),
      ]);
    });

    it("retries while the contract can't see the deposit yet", async () => {
      const created = await create();
      fakeStellarActor.getBalance.mockResolvedValue(10_000_000n);
      fakeStellarActor.invoke.mockRejectedValue(
        kiteError(created.payinAddress, 10),
      );

      await expect(service.settleTransfer(created.id)).rejects.toThrow(
        /not visible/,
      );
    });

    it("fails and refunds a settlement the contract refuses", async () => {
      const created = await create();
      fakeStellarActor.getBalance.mockResolvedValue(10_000_000n);
      fakeStellarActor.invoke.mockRejectedValue(
        kiteError(created.payinAddress, 14),
      );

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(TransferStatus.Failed);
      expect(schedulerMock.enqueueRefund).toHaveBeenCalledWith(
        created.id,
        expect.anything(),
      );
    });

    it("doesn't mistake a token's error for one of Kite's", async () => {
      const created = await create();
      fakeStellarActor.getBalance.mockResolvedValue(10_000_000n);
      fakeStellarActor.invoke.mockRejectedValue(kiteError(USDC, 13));

      await service.settleTransfer(created.id);

      expect((await reload(created.id)).status).toBe(TransferStatus.Failed);
      const timeline = await db.query.transferTimeline.findMany({
        where: eq(transferTimeline.transferId, created.id),
      });
      expect(timeline.map((item) => item.description)).toContain(
        "Settlement failed (TrustlineMissing on USDC)",
      );
    });
  });

  describe("refundTransfer", () => {
    it("refunds through the factory as the operator", async () => {
      const created = await create();
      fakeStellarActor.getBalance.mockResolvedValue(10_000_000n);
      fakeStellarActor.invoke.mockResolvedValue(
        stellarResult([
          stellarEvent(created.payinAddress, "refunded", {
            transfer_id: xdr.ScVal.scvBytes(
              Buffer.from(common.uuidToBytes32(created.id).slice(2), "hex"),
            ),
            token: Address.fromString(USDC).toScVal(),
            refund_address: Address.fromString(PAYER).toScVal(),
            amount_refunded: nativeToScVal(10_000_000n, { type: "i128" }),
          }),
        ]),
      );

      expect(await service.refundTransfer(created.id)).toEqual({
        refunded: true,
      });

      const [, , method, args] = fakeStellarActor.invoke.mock.calls[0] as [
        Caip2Id,
        string,
        string,
        xdr.ScVal[],
      ];
      expect(method).toBe("refund");
      expect(Address.fromScVal(args[1]).toString()).toBe(stellarOperator);
      expect((await reload(created.id)).status).toBe(TransferStatus.Refunded);
    });
  });
});
