import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  KeyPairSigner,
} from "near-api-js";
import { db } from "../../db";
import { operatorForward, transfer } from "../../db/schema";
import {
  NEAR_CAIP2,
  NEAR_USDC,
  createNearQuoteRow,
  nearOutcome,
  setupNearChain,
} from "../../test/near";
import { fakeNearActor, nearOperator, resetMocks } from "../../test/mocks";
import { TransferStatus } from "../../shared/constants";
import { PreconditionError } from "../../shared/errors";
import { x402Service } from "../x402.service";
import { TransferService } from "../Transfer.service";
import { OperatorForwardService } from "../OperatorForward.service";
import { nearEvent } from "../../test/near";

const scheme = vi.hoisted(() => ({
  verify: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@x402/near/exact/facilitator", () => ({
  ExactNearScheme: class {
    scheme = "exact";
    caipFamily = "near:*";
    getExtra = () => undefined;
    getSigners = () => [];
    verify = scheme.verify;
    settle = scheme.settle;
  },
}));

vi.mock("../../sdks/x402NearFacilitatorSigner", () => ({
  x402NearFacilitatorSigner: () => ({}),
}));

const service = new x402Service();
const PAYER = "agent.near";
const key = KeyPair.fromRandom("ed25519");

const signedDelegate = async (input: {
  to: string;
  amount: string;
  token?: string;
  nonce?: bigint;
}) => {
  const delegateAction = buildDelegateAction({
    senderId: PAYER,
    receiverId: input.token ?? NEAR_USDC,
    actions: [
      actions.functionCall(
        "ft_transfer",
        { receiver_id: input.to, amount: input.amount },
        30_000_000_000_000n,
        1n,
      ),
    ],
    nonce: input.nonce ?? 7n,
    maxBlockHeight: 1100n,
    publicKey: key.getPublicKey(),
  });

  const { signedDelegate } = await new KeyPairSigner(key).signDelegateAction(
    delegateAction,
  );

  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
};

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

describe("x402 on NEAR", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;

  beforeEach(async () => {
    resetMocks();
    scheme.verify
      .mockReset()
      .mockResolvedValue({ isValid: true, payer: PAYER });
    scheme.settle.mockReset();
    ({ appId, chainId, usdcId } = await setupNearChain());
  });

  const open = async () => {
    const quote = await createNearQuoteRow({
      appId,
      chainId,
      sourceTokenId: usdcId,
      targetTokenId: usdcId,
    });
    fakeNearActor.functionCall.mockResolvedValueOnce(nearOutcome([]));
    return service.createTransfer(appId, quote.id);
  };

  const pay = async (
    created: Awaited<ReturnType<typeof open>>,
    delegate?: Partial<Parameters<typeof signedDelegate>[0]>,
  ) => {
    const requirements = await service.getPaymentRequirements(
      appId,
      created.id,
    );
    const payload = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: {
        signedDelegateAction: await signedDelegate({
          to: created.payinAddress,
          amount: requirements.amount,
          ...delegate,
        }),
      },
    };

    return { requirements, payload };
  };

  it("opens the transfer with the NEAR operator as the refund account", async () => {
    const created = await open();

    expect(created.refundAddress).toBe(nearOperator);
  });

  it("asks for the source token, paid to the deposit account", async () => {
    const created = await open();

    expect(await service.getPaymentRequirements(appId, created.id)).toEqual({
      scheme: "exact",
      network: NEAR_CAIP2,
      asset: NEAR_USDC,
      amount: "1000000",
      payTo: created.payinAddress,
      maxTimeoutSeconds: expect.any(Number),
      extra: {},
    });
  });

  it("lists NEAR tokens and the NEAR relayer as supported", async () => {
    const supported = await service.getSupported(appId);

    expect(supported.kinds).toContainEqual({
      x402Version: 2,
      scheme: "exact",
      network: NEAR_CAIP2,
      extra: { asset: NEAR_USDC },
    });
    expect(supported.kinds).not.toContainEqual(
      expect.objectContaining({ extra: { asset: "near" } }),
    );
    expect(supported.signers["near:*"]).toEqual([nearOperator]);
  });

  it("verifies a delegated ft_transfer to the deposit account", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);

    expect(await service.verify(appId, payload, requirements)).toMatchObject({
      isValid: true,
    });
    expect(scheme.verify).toHaveBeenCalledOnce();
  });

  it("refuses a delegate action that pays someone else", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created, { to: "eve.near" });

    await expect(service.verify(appId, payload, requirements)).rejects.toThrow(
      PreconditionError,
    );
    expect(scheme.verify).not.toHaveBeenCalled();
  });

  it("refuses a delegate action on another token", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created, {
      token: "fake-usdc.near",
    });

    await expect(service.verify(appId, payload, requirements)).rejects.toThrow(
      "Payment asset does not match source token",
    );
  });

  it("settles through the relayer and marks the transfer x402-settled", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);
    scheme.settle.mockResolvedValue({
      success: true,
      transaction: "RelayTx1",
      network: NEAR_CAIP2,
      payer: PAYER,
    });

    expect(await service.settle(appId, payload, requirements)).toMatchObject({
      success: true,
      transaction: "RelayTx1",
      payer: PAYER,
    });

    const row = await reload(created.id);
    expect(row.status).toBe(TransferStatus.x402Settled);
    expect(row.x402Payer).toBe(PAYER);
    expect(row.x402AuthorizationNonce).toBe(`${key.getPublicKey()}:7`);
    expect(row.x402BlockchainHash).toBe("RelayTx1");
  });

  it("releases the reservation when the delegate action never landed", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);
    scheme.settle.mockResolvedValue({
      success: false,
      errorReason: "invalid_exact_near_payload",
      transaction: "",
      network: NEAR_CAIP2,
    });
    fakeNearActor.viewAccessKey.mockResolvedValue({ nonce: 6n });

    expect(await service.settle(appId, payload, requirements)).toMatchObject({
      success: false,
    });
    expect((await reload(created.id)).x402AuthorizationNonce).toBeNull();
  });

  it("waits when the delegate's nonce was used but the outcome is unknown", async () => {
    const created = await open();
    const { requirements, payload } = await pay(created);
    scheme.settle.mockRejectedValue(new Error("timeout"));
    fakeNearActor.viewAccessKey.mockResolvedValue({ nonce: 7n });

    expect(await service.settle(appId, payload, requirements)).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
    });
    expect((await reload(created.id)).x402AuthorizationNonce).toBe(
      `${key.getPublicKey()}:7`,
    );
  });

  describe("refunds of x402 payments", () => {
    it("forwards a refund the NEAR operator received to the payer", async () => {
      const created = await open();
      await db
        .update(transfer)
        .set({ x402Payer: PAYER })
        .where(eq(transfer.id, created.id));

      fakeNearActor.getBalance.mockResolvedValue(1_000_000n);
      fakeNearActor.functionCall.mockResolvedValueOnce(
        nearOutcome([
          {
            executor: created.payinAddress,
            logs: [
              nearEvent("refunded", {
                transfer_id: created.id,
                refund_account: nearOperator,
                pay_in: { Token: NEAR_USDC },
                amount_refunded: "1000000",
              }),
            ],
          },
        ]),
      );

      expect(await new TransferService().refundTransfer(created.id)).toEqual({
        refunded: true,
      });

      const [forward] = await db
        .select()
        .from(operatorForward)
        .where(eq(operatorForward.transferId, created.id));
      expect(forward).toMatchObject({
        recipient: PAYER,
        amount: 1_000_000n,
        status: "Pending",
      });

      fakeNearActor.view.mockImplementation(async (...args: unknown[]) =>
        args[2] === "storage_balance_bounds"
          ? { min: "1250000000000000000000" }
          : null,
      );
      fakeNearActor.functionCall.mockResolvedValueOnce({
        ...nearOutcome([]),
        transactionHash: "ForwardTx1",
      });

      await new OperatorForwardService().processForward(forward.id);

      expect(fakeNearActor.functionCall.mock.calls.at(-1)?.[1]).toEqual([
        expect.objectContaining({
          contractId: NEAR_USDC,
          method: "storage_deposit",
          args: { account_id: PAYER, registration_only: true },
        }),
        expect.objectContaining({
          contractId: NEAR_USDC,
          method: "ft_transfer",
          args: { receiver_id: PAYER, amount: "1000000" },
          deposit: 1n,
        }),
      ]);

      const [sent] = await db
        .select()
        .from(operatorForward)
        .where(eq(operatorForward.id, forward.id));
      expect(sent).toMatchObject({
        status: "Sent",
        blockchainHash: "ForwardTx1",
      });
    });
  });
});
