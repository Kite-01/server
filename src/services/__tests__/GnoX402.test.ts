import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { GnoWallet } from "@gnolang/gno-js-client";
import { ExactGnoScheme } from "@gnolang/x402/exact/client";
import { db } from "../../db";
import { transfer } from "../../db/schema";
import { createGnoQuoteRow, setupGnoChain } from "../../test/gno";
import {
  fakeGnoActor,
  gnoOperator,
  resetMocks,
  schedulerMock,
} from "../../test/mocks";
import { TransferStatus } from "../../shared/constants";
import { SettlePolling } from "../../sdks/x402GnoFacilitator";
import { x402Service } from "../x402.service";

const service = new x402Service();
const agentMnemonic =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

const account = (sequence: string) => ({
  BaseAccount: {
    address: "",
    coins: "100000000ugnot",
    public_key: null,
    account_number: "7",
    sequence,
  },
});

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

describe("x402 on Gno", () => {
  let appId: string;
  let chainId: string;
  let gnotId: string;
  let tusdId: string;
  let agent: GnoWallet;
  let agentAddress: string;
  const chain = {
    getAccount: vi.fn(async () => account("3")),
    sendTransaction: vi.fn(async () => ({ hash: "" })),
  };

  beforeEach(async () => {
    resetMocks();
    SettlePolling.ms = 0;
    chain.getAccount.mockReset().mockResolvedValue(account("3"));
    chain.sendTransaction.mockReset().mockResolvedValue({ hash: "" });
    fakeGnoActor.provider.mockResolvedValue(chain);
    fakeGnoActor.getBalance.mockResolvedValue(100_000_000n);
    ({ appId, chainId, gnotId, tusdId } = await setupGnoChain());

    agent = await GnoWallet.fromMnemonic(agentMnemonic);
    agentAddress = await agent.getAddress();
    agent.connect({
      getAccount: async () => account("3"),
      getGasPrice: async () => null,
    } as never);
  });

  const open = async (sourceTokenId = gnotId) => {
    const quote = await createGnoQuoteRow({
      appId,
      chainId,
      sourceTokenId,
      targetTokenId: sourceTokenId,
    });
    return service.createTransfer(appId, quote.id);
  };

  // what an agent sends, signed by @gnolang/x402's own client
  const pay = async (
    created: Awaited<ReturnType<typeof open>>,
    change: Record<string, unknown> = {},
  ) => {
    const requirements = await service.getPaymentRequirements(
      appId,
      created.id,
    );
    const signed = await new ExactGnoScheme(
      agent as never,
    ).createPaymentPayload(2, {
      ...requirements,
      ...change,
    } as never);
    const transaction = String(signed.payload.transaction);
    return {
      requirements,
      hash: createHash("sha256")
        .update(Buffer.from(transaction, "base64"))
        .digest("hex")
        .toUpperCase(),
      payload: {
        x402Version: 2 as const,
        accepted: requirements,
        payload: { transaction },
      },
    };
  };

  it("offers GNOT to the deposit address, with the payer paying gas", async () => {
    const created = await open();
    const requirements = await service.getPaymentRequirements(
      appId,
      created.id,
    );

    expect(created.refundAddress).toBe(gnoOperator);
    expect(requirements).toMatchObject({
      scheme: "exact",
      network: "gno:onyx-1",
      asset: "ugnot",
      amount: "10000000",
      payTo: created.payinAddress,
      extra: { areFeesSponsored: false },
    });
  });

  it("doesn't offer a GRC20", async () => {
    const created = await open(tusdId);
    await expect(
      service.getPaymentRequirements(appId, created.id),
    ).rejects.toThrow(/GNOT only/);

    const supported = await service.getSupported();
    expect(supported.kinds.filter((k) => k.network === "gno:onyx-1")).toEqual([
      {
        x402Version: 2,
        scheme: "exact",
        network: "gno:onyx-1",
        extra: { asset: "ugnot", areFeesSponsored: false },
      },
    ]);
  });

  it("verifies a payment @gnolang/x402 signed", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);

    expect(await service.verify(appId, payload, requirements)).toEqual({
      isValid: true,
      payer: agentAddress,
    });
  });

  it("refuses a payment whose sequence was spent, or signed for another chain", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);

    chain.getAccount.mockResolvedValue(account("4"));
    expect(await service.verify(appId, payload, requirements)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_gno_payload_signature",
    });

    chain.getAccount.mockResolvedValue(account("3"));
    const other = await pay(created, { network: "gno:test5" });
    expect(
      await service.verify(appId, other.payload, requirements),
    ).toMatchObject({ isValid: false });
  });

  it("refuses a payer who can't cover the amount and the gas", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);
    fakeGnoActor.getBalance.mockResolvedValue(10_000_000n);

    expect(await service.verify(appId, payload, requirements)).toMatchObject({
      isValid: false,
      invalidReason: "insufficient_funds",
    });
  });

  it("refuses a payment of another amount", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created, { amount: "1" });

    await expect(service.verify(appId, payload, requirements)).rejects.toThrow(
      /value does not match/,
    );
  });

  it("broadcasts the payment and accepts it once it's in a block", async () => {
    const created = await open();
    const { requirements, payload, hash } = await pay(created);
    fakeGnoActor.getTransactionStatus.mockResolvedValue({
      status: "success",
      transactionHash: hash,
    });

    const settled = await service.settle(appId, payload, requirements);

    expect(settled).toEqual({
      success: true,
      payer: agentAddress,
      transaction: hash,
      network: "gno:onyx-1",
    });
    expect(chain.sendTransaction).toHaveBeenCalledWith(
      payload.payload.transaction,
      "broadcast_tx_sync",
    );
    const row = await reload(created.id);
    expect(row.status).toBe(TransferStatus.x402Settled);
    expect(row.x402BlockchainHash).toBe(hash);
    expect(schedulerMock.enqueueSettle).toHaveBeenCalledWith(created.id);
  });

  it("answers settlement_pending until the block lands, without broadcasting again", async () => {
    const created = await open();
    const { requirements, payload, hash } = await pay(created);

    const pending = await service.settle(appId, payload, requirements);
    expect(pending).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: hash,
    });

    fakeGnoActor.getTransactionStatus.mockResolvedValue({
      status: "success",
      transactionHash: hash,
    });
    const settled = await service.settle(appId, payload, requirements);

    expect(settled).toMatchObject({ success: true, transaction: hash });
    expect(chain.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("releases a payment the chain refused", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);
    chain.sendTransaction.mockRejectedValue(new Error("insufficient fee"));
    // verified twice, then the payer spends the sequence elsewhere
    chain.getAccount
      .mockResolvedValueOnce(account("3"))
      .mockResolvedValueOnce(account("3"))
      .mockResolvedValue(account("4"));

    const result = await service.settle(appId, payload, requirements);

    expect(result).toMatchObject({
      success: false,
      errorReason: "transaction_failed",
    });
    expect((await reload(created.id)).x402AuthorizationNonce).toBeNull();
  });
});
