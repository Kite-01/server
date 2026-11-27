import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  Account,
  Address,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { db } from "../../db";
import { transfer } from "../../db/schema";
import {
  STELLAR_USDC as USDC,
  createStellarQuoteRow,
  setupStellarChain,
} from "../../test/stellar";
import {
  fakeStellarActor,
  resetMocks,
  schedulerMock,
  stellarOperator,
} from "../../test/mocks";
import { TransferStatus } from "../../shared/constants";
import { getX402Observer, withX402Observer } from "../../shared/context/x402";
import {
  stellarAuthorizationValidBefore,
  x402StellarFacilitatorSigner,
} from "../../sdks/x402StellarFacilitatorSigner";
import { x402Service } from "../x402.service";

const scheme = vi.hoisted(() => ({
  options: undefined as unknown,
  signers: undefined as unknown,
  verify: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@x402/stellar/exact/facilitator", () => ({
  ExactStellarScheme: class {
    scheme = "exact";
    caipFamily = "stellar:*";
    constructor(signers: unknown, options: unknown) {
      scheme.signers = signers;
      scheme.options = options;
    }
    getExtra = () => ({ areFeesSponsored: true });
    getSigners = () => [];
    verify = scheme.verify;
    settle = scheme.settle;
  },
}));

vi.mock("@x402/stellar", async (original) => ({
  ...(await original<typeof import("@x402/stellar")>()),
  getEstimatedLedgerCloseTimeSeconds: async () => 5,
}));

const service = new x402Service();
const payer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const HASH = "cd".repeat(32);

const payment = (to: string, amount: string, expirationLedger = 1012) => {
  const args = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(USDC).toScAddress(),
    functionName: "transfer",
    args: [
      Address.fromString(payer.publicKey()).toScVal(),
      Address.fromString(to).toScVal(),
      nativeToScVal(BigInt(amount), { type: "i128" }),
    ],
  });

  return new TransactionBuilder(new Account(payer.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(args),
        auth: [
          new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
              new xdr.SorobanAddressCredentials({
                address: Address.fromString(payer.publicKey()).toScAddress(),
                nonce: xdr.Int64.fromString("42"),
                signatureExpirationLedger: expirationLedger,
                signature: xdr.ScVal.scvVoid(),
              }),
            ),
            rootInvocation: new xdr.SorobanAuthorizedInvocation({
              function:
                xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                  args,
                ),
              subInvocations: [],
            }),
          }),
        ],
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
};

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

describe("x402 on Stellar", () => {
  it("converts an authorization's expiry ledger to a time", () => {
    expect(
      stellarAuthorizationValidBefore({
        expirationLedger: 1012,
        latestLedger: 1000,
        ledgerSeconds: 5,
        now: 1_800_000_000,
      }),
    ).toBe("1800000060");
    expect(
      stellarAuthorizationValidBefore({
        expirationLedger: 990,
        latestLedger: 1000,
        ledgerSeconds: 5,
        now: 1_800_000_000,
      }),
    ).toBe("1800000000");
  });

  describe("the facilitator", () => {
    beforeEach(() => resetMocks());

    it("settles from its own account and has the operator fee-bump, recording the hash first", async () => {
      const { signer, feeBumpSigner } = x402StellarFacilitatorSigner(
        "stellar:testnet",
        fakeStellarActor as never,
      );
      expect(signer.address).toBe(fakeStellarActor.keypair(1).publicKey());
      expect(feeBumpSigner.address).toBe(stellarOperator);
      expect(signer.address).not.toBe(feeBumpSigner.address);

      const inner = TransactionBuilder.fromXDR(
        payment(USDC, "1"),
        Networks.TESTNET,
      ) as never;
      const bump = TransactionBuilder.buildFeeBumpTransaction(
        stellarOperator,
        "200",
        inner,
        Networks.TESTNET,
      );

      const broadcast = vi.fn(async () => undefined);
      const signed = await withX402Observer(
        { onSubmitted: async () => undefined, onBroadcast: broadcast },
        () =>
          feeBumpSigner.signTransaction(bump.toXDR(), {
            networkPassphrase: Networks.TESTNET,
          }),
      );

      expect(signed.error).toBeUndefined();
      expect(broadcast).toHaveBeenCalledWith(bump.hash().toString("hex"));
    });
  });

  describe("x402Service", () => {
    let appId: string;
    let chainId: string;
    let usdcId: string;

    beforeEach(async () => {
      resetMocks();
      scheme.verify
        .mockReset()
        .mockResolvedValue({ isValid: true, payer: payer.publicKey() });
      scheme.settle.mockReset();
      ({ appId, chainId, usdcId } = await setupStellarChain());
    });

    const open = async () => {
      const quote = await createStellarQuoteRow({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });
      return service.createTransfer(appId, quote.id);
    };

    const pay = async (created: Awaited<ReturnType<typeof open>>) => {
      const requirements = await service.getPaymentRequirements(
        appId,
        created.id,
      );
      return {
        requirements,
        payload: {
          x402Version: 2 as const,
          accepted: requirements,
          payload: {
            transaction: payment(created.payinAddress, requirements.amount),
          },
        },
      };
    };

    it("registers the Stellar scheme with the facilitator account and the operator's fee bump", async () => {
      const created = await open();
      const requirements = await service.getPaymentRequirements(
        appId,
        created.id,
      );

      expect(created.refundAddress).toBe(stellarOperator);
      expect(requirements).toMatchObject({
        network: "stellar:testnet",
        asset: USDC,
        payTo: created.payinAddress,
        extra: { areFeesSponsored: true },
      });
      expect(scheme.signers).toEqual([
        expect.objectContaining({
          address: fakeStellarActor.keypair(1).publicKey(),
        }),
      ]);
      expect(scheme.options).toMatchObject({
        rpcConfig: { url: "https://soroban-testnet.stellar.org" },
        feeBumpSigner: expect.objectContaining({ address: stellarOperator }),
        maxTransactionFeeStroops: 1_000_000,
      });
    });

    it("lists the facilitator account as the Stellar signer", async () => {
      const supported = await service.getSupported();
      expect(supported.signers["stellar:*"]).toEqual([
        fakeStellarActor.keypair(1).publicKey(),
      ]);
      expect(supported.kinds).toContainEqual(
        expect.objectContaining({ network: "stellar:testnet" }),
      );
    });

    it("refuses an authorization that outlives the settlement window", async () => {
      const created = await open();
      const { requirements, payload } = await pay(created);
      payload.payload.transaction = payment(
        created.payinAddress,
        requirements.amount,
        1000 + 60 * 60,
      );

      await expect(
        service.settle(appId, payload, requirements),
      ).rejects.toThrow(/past the transfer's settlement window/);
    });

    it("answers settlement_pending while the transaction is unconfirmed, then accepts it", async () => {
      const created = await open();
      const { requirements, payload } = await pay(created);
      scheme.settle.mockImplementation(async () => {
        await getX402Observer()?.onBroadcast(HASH);
        return {
          success: false,
          errorReason: "settle_exact_stellar_transaction_failed",
          transaction: HASH,
          network: "stellar:testnet",
          payer: payer.publicKey(),
        };
      });

      const pending = await service.settle(appId, payload, requirements);
      expect(pending).toMatchObject({
        success: false,
        errorReason: "settlement_pending",
        transaction: HASH,
      });
      expect((await reload(created.id)).x402BlockchainHash).toBe(HASH);

      fakeStellarActor.getTransactionStatus.mockResolvedValue({
        status: "success",
        transactionHash: HASH,
      });
      const settled = await service.settle(appId, payload, requirements);

      expect(settled).toMatchObject({ success: true, transaction: HASH });
      expect(scheme.settle).toHaveBeenCalledTimes(1);
      expect((await reload(created.id)).status).toBe(
        TransferStatus.x402Settled,
      );
      expect(schedulerMock.enqueueSettle).toHaveBeenCalledWith(created.id);
    });

    it("releases a payment that was never sent", async () => {
      const created = await open();
      const { requirements, payload } = await pay(created);
      scheme.settle.mockResolvedValue({
        success: false,
        errorReason: "settle_exact_stellar_transaction_submission_failed",
        transaction: "",
        network: "stellar:testnet",
        payer: payer.publicKey(),
      });

      const result = await service.settle(appId, payload, requirements);

      expect(result).toMatchObject({
        success: false,
        errorReason: "settle_exact_stellar_transaction_submission_failed",
      });
      expect((await reload(created.id)).x402AuthorizationNonce).toBeNull();
    });
  });
});
