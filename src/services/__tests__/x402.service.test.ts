import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  keccak256,
  type Hex,
} from "viem";
import {
  IMPLEMENTATION,
  createApp,
  createConfiguredChain,
  createToken,
  address,
  USDC,
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
  ChainNotConfiguredForx402Error,
  NotFoundError,
  PreconditionError,
  QuoteExpiredError,
} from "../../shared/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainConfig, quote, transfer } from "../../db/schema";
import { TransferStatus } from "../../shared/constants";
import { ChainService } from "../Chain.service";
import { x402Service } from "../x402.service";
import { common } from "../../shared/common";
import { kite } from "../../shared/kiteContract";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const facilitator = vi.hoisted(() => ({
  verify: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@x402/core/facilitator", () => ({
  x402Facilitator: class {
    register() {
      return this;
    }
    verify = facilitator.verify;
    settle = facilitator.settle;
  },
}));

vi.mock("@x402/evm/exact/facilitator", () => ({
  ExactEvmScheme: class {},
}));

vi.mock("../../shared/providers", () => ({
  runProviderMethod: vi.fn(async () => undefined),
  isProviderConfiguredForAction: vi.fn(),
  getProvider: vi.fn(),
  ProvidersMap: {},
}));

const PAYER = address(0x9a7);
const NONCE = `0x${"11".repeat(32)}`;
const SIGNATURE = `0x${"ab".repeat(65)}` as Hex;
const CAIP2 = "eip155:8453" as Caip2Id;

const client = {
  multicall: vi.fn(),
  readContract: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
};

type Requirements = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

const requirementsFor = (
  row: { payinAddress: string },
  amount = "1000000",
): Requirements => ({
  scheme: "exact",
  network: CAIP2,
  asset: USDC,
  amount,
  payTo: row.payinAddress,
  maxTimeoutSeconds: 60,
  extra: { name: "USD Coin", version: "2" },
});

const payloadFor = (
  requirements: Requirements,
  overrides: Partial<{
    from: string;
    to: string;
    value: string;
    validBefore: string;
    nonce: string;
    signature: string;
  }> = {},
) => ({
  x402Version: 2 as const,
  accepted: requirements,
  payload: {
    signature: overrides.signature ?? SIGNATURE,
    authorization: {
      from: overrides.from ?? PAYER,
      to: overrides.to ?? requirements.payTo,
      value: overrides.value ?? requirements.amount,
      validAfter: "0",
      validBefore:
        overrides.validBefore ?? String(Math.floor(Date.now() / 1000) + 60),
      nonce: overrides.nonce ?? NONCE,
    },
  },
});

const transferLog = (row: { payinAddress: string }, amount = 1_000_000n) => ({
  address: USDC,
  topics: encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from: PAYER as Hex, to: row.payinAddress as Hex },
  }),
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  logIndex: 0,
  transactionHash: "0xpaid",
});

const reload = async (id: string) => {
  const [row] = await db.select().from(transfer).where(eq(transfer.id, id));
  return row;
};

describe("x402Service", () => {
  const service = new x402Service();
  let appId: string;
  let chainId: string;
  let usdcId: string;

  beforeEach(async () => {
    resetMocks();
    for (const fn of [
      ...Object.values(client),
      ...Object.values(facilitator),
    ]) {
      fn.mockReset();
    }

    fakeActor.publicClient.mockResolvedValue(client);
    client.multicall.mockResolvedValue([
      { result: "USD Coin" },
      { result: "2" },
      { result: false },
    ]);
    facilitator.verify.mockResolvedValue({ isValid: true, payer: PAYER });
    facilitator.settle.mockResolvedValue({
      success: true,
      payer: PAYER,
      transaction: "0xsettled",
      network: CAIP2,
    });

    appId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    usdcId = configured.usdc.id;
  });

  const open = async (
    values: Partial<Parameters<typeof createTransferRow>[0]> & {
      expiresAt?: Date;
    } = {},
  ) => {
    const q = await createQuoteRow({
      appId,
      chainId,
      sourceTokenId: usdcId,
      targetTokenId: usdcId,
      expiresAt: values.expiresAt,
    });

    return createTransferRow({
      appId,
      quote: q,
      refundAddress: operatorAddress,
      ...values,
    });
  };

  describe("getSupported", () => {
    it("lists EIP-3009 tokens on configured chains", async () => {
      await createToken(chainId, {
        symbol: "NOPE",
        supportsEIP3009: false,
        version: "1",
      });
      await createToken(chainId, {
        symbol: "NOVER",
        supportsEIP3009: true,
        version: null,
      });

      const supported = await service.getSupported();

      expect(supported.kinds).toEqual([
        {
          x402Version: 2,
          scheme: "exact",
          network: CAIP2,
          extra: { asset: USDC, name: "USD Coin", version: "2" },
        },
      ]);
      expect(supported.signers).toEqual({ "eip155:*": [operatorAddress] });
    });

    it("includes chains without a gas sponsor, where the operator pays gas", async () => {
      await db
        .update(chainConfig)
        .set({ gasSponsorProviders: [] })
        .where(eq(chainConfig.chainId, chainId));

      expect((await service.getSupported()).kinds).toEqual([
        expect.objectContaining({ network: CAIP2 }),
      ]);
    });

    it("leaves out inactive chains", async () => {
      await new ChainService().updateChainActiveStatus(chainId, false);

      expect((await service.getSupported()).kinds).toEqual([]);
    });
  });

  describe("getPaymentRequirements", () => {
    it("describes what the payer has to authorise", async () => {
      const row = await open();

      expect(await service.getPaymentRequirements(appId, row.id)).toMatchObject(
        {
          scheme: "exact",
          network: CAIP2,
          asset: USDC,
          amount: "1000000",
          payTo: row.payinAddress,
          extra: { name: "USD Coin", version: "2" },
        },
      );
    });

    it("caps the authorisation's validity inside the quote's life", async () => {
      const row = await open();
      const requirements = await service.getPaymentRequirements(appId, row.id);

      expect(requirements.maxTimeoutSeconds).toBeLessThanOrEqual(120);
      expect(requirements.maxTimeoutSeconds).toBeGreaterThanOrEqual(15);
    });

    it("does not reveal another app's transfer", async () => {
      const row = await open();
      const other = await createApp();

      await expect(
        service.getPaymentRequirements(other.id, row.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("only serves transfers that are awaiting a deposit", async () => {
      const row = await open({ status: TransferStatus.Settled });

      await expect(
        service.getPaymentRequirements(appId, row.id),
      ).rejects.toBeInstanceOf(PreconditionError);
    });

    it("refuses expired quotes and quotes about to expire", async () => {
      const expired = await open({ expiresAt: new Date(Date.now() - 1000) });
      const soon = await open({ expiresAt: new Date(Date.now() + 40_000) });

      await expect(
        service.getPaymentRequirements(appId, expired.id),
      ).rejects.toBeInstanceOf(QuoteExpiredError);
      await expect(
        service.getPaymentRequirements(appId, soon.id),
      ).rejects.toThrow("expires too soon");
    });

    it("takes payments on a chain without a gas sponsor", async () => {
      const row = await open();
      await db
        .update(chainConfig)
        .set({ gasSponsorProviders: [] })
        .where(eq(chainConfig.chainId, chainId));

      expect(await service.getPaymentRequirements(appId, row.id)).toMatchObject(
        { network: CAIP2, payTo: row.payinAddress },
      );
    });

    it("needs an active chain", async () => {
      const row = await open();
      await new ChainService().updateChainActiveStatus(chainId, false);

      await expect(
        service.getPaymentRequirements(appId, row.id),
      ).rejects.toBeInstanceOf(ChainNotConfiguredForx402Error);
    });

    it("needs a token that supports EIP-3009", async () => {
      const row = await open();
      client.multicall.mockResolvedValue([
        { result: undefined },
        { result: undefined },
        { result: undefined },
      ]);

      await expect(
        service.getPaymentRequirements(appId, row.id),
      ).rejects.toThrow("doesn't support EIP-3009");
    });
  });

  describe("createTransfer", () => {
    it("opens the transfer with the operator as refund address", async () => {
      vi.spyOn(kite, "predictAddress").mockImplementation(
        async (_client, _factory, struct) =>
          payinFor(common.bytes32ToUuid(struct.id)!),
      );
      vi.spyOn(kite, "simulateFactoryCall").mockResolvedValue({ ok: true });
      vi.spyOn(kite, "getImplementation").mockResolvedValue(IMPLEMENTATION);
      const q = await createQuoteRow({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });

      const created = await service.createTransfer(appId, q.id);

      expect(created).toMatchObject({
        refundAddress: operatorAddress,
        status: TransferStatus.AwaitingDeposit,
      });
    });
  });

  describe("verify", () => {
    it("hands a valid payment to the facilitator", async () => {
      const row = await open();
      const requirements = requirementsFor(row);
      const payload = payloadFor(requirements);

      const result = await service.verify(
        appId,
        payload as never,
        requirements as never,
      );

      expect(result).toEqual({ isValid: true, payer: PAYER });
      expect(facilitator.verify).toHaveBeenCalledWith(payload, requirements);
    });

    it.each([
      [
        "a different amount than the quote",
        (r: Requirements) => ({
          requirements: { ...r, amount: "999999" },
          payloadOverrides: { value: "999999" },
        }),
      ],
      [
        "a different asset",
        (r: Requirements) => ({
          requirements: { ...r, asset: address(0x1) },
          payloadOverrides: {},
        }),
      ],
      [
        "another network",
        (r: Requirements) => ({
          requirements: { ...r, network: "eip155:1" },
          payloadOverrides: {},
        }),
      ],
      [
        "an unsupported scheme",
        (r: Requirements) => ({
          requirements: { ...r, scheme: "upto" },
          payloadOverrides: {},
        }),
      ],
    ])("rejects %s", async (_label, mutate) => {
      const row = await open();
      const { requirements, payloadOverrides } = mutate(requirementsFor(row));
      const payload = payloadFor(requirements, payloadOverrides);

      await expect(
        service.verify(appId, payload as never, requirements as never),
      ).rejects.toBeInstanceOf(PreconditionError);
      expect(facilitator.verify).not.toHaveBeenCalled();
    });

    it("rejects an authorisation paid to somewhere else", async () => {
      const row = await open();
      const requirements = requirementsFor(row);
      const payload = payloadFor(requirements, { to: address(0xbad) });

      await expect(
        service.verify(appId, payload as never, requirements as never),
      ).rejects.toThrow("Authorization destination does not match payTo");
    });

    it("rejects an authorisation that outlives the settlement window", async () => {
      const row = await open();
      const requirements = requirementsFor(row);
      const payload = payloadFor(requirements, {
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
      });

      await expect(
        service.verify(appId, payload as never, requirements as never),
      ).rejects.toThrow("stays valid past the transfer's settlement window");
    });

    it("rejects payments for unknown or foreign pay-in addresses", async () => {
      const row = await open();
      const other = await createApp();
      const requirements = requirementsFor(row);

      await expect(
        service.verify(
          other.id,
          payloadFor(requirements) as never,
          requirements as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects malformed payloads", async () => {
      const row = await open();
      const requirements = requirementsFor(row);

      await expect(
        service.verify(
          appId,
          { x402Version: 1 } as never,
          requirements as never,
        ),
      ).rejects.toThrow();
    });
  });

  describe("settle", () => {
    const attempt = async (
      row: Awaited<ReturnType<typeof open>>,
      overrides: Parameters<typeof payloadFor>[1] = {},
    ) => {
      const requirements = requirementsFor(row);
      return service.settle(
        appId,
        payloadFor(requirements, overrides) as never,
        requirements as never,
      );
    };

    it("settles, records the payment and queues the transfer's settlement", async () => {
      const row = await open();

      const result = await attempt(row);

      expect(result).toEqual({
        success: true,
        payer: PAYER,
        transaction: "0xsettled",
        network: CAIP2,
      });
      expect(await reload(row.id)).toMatchObject({
        status: TransferStatus.x402Settled,
        x402Payer: PAYER,
        x402AuthorizationNonce: NONCE,
        x402AuthorizationHash: keccak256(SIGNATURE),
        x402BlockchainHash: "0xsettled",
        x402LeaseExpiresAt: null,
      });
      expect((await reload(row.id)).x402SettledAt).toBeInstanceOf(Date);
      expect(schedulerMock.enqueueSettle).toHaveBeenCalledWith(row.id);
    });

    it("does not touch the chain when the facilitator rejects the payment", async () => {
      const row = await open();
      facilitator.verify.mockResolvedValue({
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_signature",
        invalidMessage: "bad signature",
      });

      const result = await attempt(row);

      expect(result).toMatchObject({
        success: false,
        errorReason: "invalid_exact_evm_payload_signature",
      });
      expect(facilitator.settle).not.toHaveBeenCalled();
      expect((await reload(row.id)).x402AuthorizationNonce).toBeNull();
    });

    it("lets only one payment reserve a transfer", async () => {
      const row = await open();
      await attempt(row);

      await expect(
        attempt(row, {
          nonce: `0x${"22".repeat(32)}`,
          signature: `0x${"cd".repeat(65)}`,
        }),
      ).rejects.toThrow(PreconditionError);
      expect(facilitator.settle).toHaveBeenCalledTimes(1);
    });

    it("releases the reservation when settlement failed and the authorisation is unused", async () => {
      const row = await open();
      facilitator.settle.mockRejectedValue(new Error("rpc down"));
      client.readContract.mockResolvedValue(false);

      await expect(attempt(row)).rejects.toThrow("rpc down");

      expect(await reload(row.id)).toMatchObject({
        status: TransferStatus.AwaitingDeposit,
        x402AuthorizationNonce: null,
        x402Payer: null,
      });
    });

    it("reports a pending settlement when the authorisation state cannot be read", async () => {
      const row = await open();
      facilitator.settle.mockRejectedValue(new Error("timeout"));
      client.readContract.mockRejectedValue(new Error("rpc down"));

      const result = await attempt(row);

      expect(result).toMatchObject({
        success: false,
        errorReason: "settlement_pending",
      });
      expect((await reload(row.id)).x402AuthorizationNonce).toBe(NONCE);
    });

    it("recognises a payment that landed even though settle threw", async () => {
      const row = await open();
      facilitator.settle.mockRejectedValue(new Error("timeout"));
      client.readContract.mockResolvedValue(true);
      await createDepositRow({
        address: row.payinAddress,
        chainId,
        tokenId: usdcId,
        sender: PAYER,
        amount: 1_000_000n,
        hash: "0xlanded",
      });

      const result = await attempt(row);

      expect(result).toMatchObject({ success: true, transaction: "0xlanded" });
      expect((await reload(row.id)).status).toBe(TransferStatus.x402Settled);
    });

    it("finishes a retried payment from its recorded transaction", async () => {
      const row = await open();
      const requirements = requirementsFor(row);
      await db
        .update(transfer)
        .set({
          x402Payer: PAYER,
          x402AuthorizationNonce: NONCE,
          x402AuthorizationHash: keccak256(SIGNATURE),
          x402BlockchainHash: "0xpaid",
          x402LeaseExpiresAt: new Date(Date.now() + 60_000),
        })
        .where(eq(transfer.id, row.id));
      client.getTransactionReceipt.mockResolvedValue({
        status: "success",
        logs: [transferLog(row)],
      });

      const result = await service.settle(
        appId,
        payloadFor(requirements) as never,
        requirements as never,
      );

      expect(result).toMatchObject({ success: true, transaction: "0xpaid" });
      expect(facilitator.settle).not.toHaveBeenCalled();
      expect((await reload(row.id)).status).toBe(TransferStatus.x402Settled);
    });

    it("tells a retry to wait while another worker holds the lease", async () => {
      const row = await open();
      const requirements = requirementsFor(row);
      await db
        .update(transfer)
        .set({
          x402Payer: PAYER,
          x402AuthorizationNonce: NONCE,
          x402AuthorizationHash: keccak256(SIGNATURE),
          x402LeaseExpiresAt: new Date(Date.now() + 60_000),
        })
        .where(eq(transfer.id, row.id));
      client.readContract.mockResolvedValue(false);

      const result = await service.settle(
        appId,
        payloadFor(requirements) as never,
        requirements as never,
      );

      expect(result).toMatchObject({
        success: false,
        errorReason: "settlement_pending",
      });
      expect(facilitator.settle).not.toHaveBeenCalled();
    });

    it("takes the payment again once the lease has lapsed and nothing was paid", async () => {
      const row = await open();
      const requirements = requirementsFor(row);
      await db
        .update(transfer)
        .set({
          x402Payer: PAYER,
          x402AuthorizationNonce: NONCE,
          x402AuthorizationHash: keccak256(SIGNATURE),
          x402LeaseExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(transfer.id, row.id));
      client.readContract.mockResolvedValue(false);

      const result = await service.settle(
        appId,
        payloadFor(requirements) as never,
        requirements as never,
      );

      expect(result).toMatchObject({ success: true, transaction: "0xsettled" });
      expect(facilitator.settle).toHaveBeenCalledTimes(1);
    });

    it("refuses to settle after the quote's settlement window", async () => {
      const row = await open();
      await db
        .update(quote)
        .set({ expiresAt: new Date(Date.now() + 10_000) })
        .where(eq(quote.id, row.quoteId));

      await expect(attempt(row)).rejects.toBeInstanceOf(QuoteExpiredError);
    });
  });
});
