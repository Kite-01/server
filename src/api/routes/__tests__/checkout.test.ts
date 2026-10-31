import {
  acceptChain,
  IMPLEMENTATION,
  address,
  createApp,
  createConfiguredChain,
  createPaymentLink,
  createToken,
  USDC,
  WETH,
} from "../../../test/factories";
import {
  app as appTable,
  chainConfig as chainConfigTable,
  paymentLink as paymentLinkTable,
  priceFeed,
  token as tokenTable,
  transfer as transferTable,
} from "../../../db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  createDepositRow,
  createQuoteRow,
  createTransferRow,
} from "../../../test/transfers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PaymentLinkUsage, TransferStatus } from "../../../shared/constants";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { fakeActor, resetMocks, stubPools } from "../../../test/mocks";
import { rootCredentials, call, client } from "../../../test/api";
import { payinFor } from "../../../test/transfers";
import { common } from "../../../shared/common";
import { kite } from "../../../shared/kiteContract";
import { eq } from "drizzle-orm";
import { db } from "../../../db";

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

vi.mock("../../../shared/providers", () => ({
  runProviderMethod: vi.fn(async () => undefined),
  isProviderConfiguredForAction: vi.fn(),
  getProvider: vi.fn(),
  ProvidersMap: {},
}));

const get = (path: string) => call("GET", path, {});
const post = (path: string, body: unknown) => {
  return call("POST", path, { "content-type": "application/json" }, { body });
};
const PAYER = address(0x9a7);

describe("checkout", () => {
  let appId: string;
  let chain: Awaited<ReturnType<typeof createConfiguredChain>>;
  let link: Awaited<ReturnType<typeof createPaymentLink>>;
  let otherLink: Awaited<ReturnType<typeof createPaymentLink>>;

  beforeEach(async () => {
    resetMocks();
    fakeActor.publicClient.mockResolvedValue({
      multicall: vi
        .fn()
        .mockResolvedValue([
          { result: "USD Coin" },
          { result: "2" },
          { result: false },
        ]),
    });
    vi.spyOn(kite, "predictAddress").mockImplementation(
      async (_client, _factory, struct) =>
        payinFor(common.bytes32ToUuid(struct.id)!),
    );
    vi.spyOn(kite, "simulateFactoryCall").mockResolvedValue({ ok: true });
    vi.spyOn(kite, "getImplementation").mockResolvedValue(IMPLEMENTATION);
    facilitator.verify.mockReset().mockResolvedValue({
      isValid: true,
      payer: PAYER,
    });
    facilitator.settle.mockReset().mockResolvedValue({
      success: true,
      payer: PAYER,
      transaction: "0xsettled",
      network: "eip155:8453",
    });

    appId = (await createApp({ name: "Shop" })).id;
    chain = await createConfiguredChain();
    await acceptChain(appId, chain.chain.id);
    link = await createPaymentLink(appId, {
      title: "Pro plan",
      amount: "25",
    });

    otherLink = await createPaymentLink(appId);
  });

  const quoteFor = (paymentLinkId: string) => {
    return createQuoteRow({
      appId,
      chainId: chain.chain.id,
      sourceTokenId: chain.usdc.id,
      targetTokenId: chain.usdc.id,
      paymentLinkId,
    });
  };

  describe("GET /api/checkout/:id", () => {
    it("describes the link and how it can be paid, without credentials", async () => {
      await createToken(chain.chain.id, {
        address: WETH,
        symbol: "WETH",
        decimals: 18,
        supportsEIP3009: true,
        version: "1",
      });

      const res = await get(`/api/checkout/${link.id}`);

      expect(res.status).toBe(200);
      expect(res.json.paymentLink).toMatchObject({
        id: link.id,
        title: "Pro plan",
        currency: "USD",
        usage: "OneTime",
      });

      expect(res.json.paymentLink.appId).toBeUndefined();
      expect(res.json.app).toMatchObject({ name: "Shop" });
      expect(res.json.chains).toHaveLength(1);
      expect(res.json.chains[0]).toMatchObject({
        id: chain.chain.id,
        caip2Id: "eip155:8453",
        chainId: 8453,
        icon: expect.stringContaining("/blockchains/base/info/logo.png"),
        settlementToken: {
          address: USDC,
          symbol: "USDC",
          x402: true,
        },
      });

      const tokens = Object.fromEntries(
        res.json.chains[0].tokens.map(
          (t: { symbol: string; x402: boolean }) => [t.symbol, t.x402],
        ),
      );

      expect(tokens).toEqual({ USDC: true, WETH: false });
    });

    it("only lists the chains the app takes payments on", async () => {
      await createConfiguredChain("eip155:10");

      const res = await get(`/api/checkout/${link.id}`);

      expect(
        res.json.chains.map((c: { caip2Id: string }) => c.caip2Id),
      ).toEqual(["eip155:8453"]);
    });

    it("is not found for an unknown link or a deleted app", async () => {
      expect((await get(`/api/checkout/${crypto.randomUUID()}`)).status).toBe(
        404,
      );

      await db
        .update(appTable)
        .set({ deletedAt: new Date() })
        .where(eq(appTable.id, appId));

      expect((await get(`/api/checkout/${link.id}`)).status).toBe(404);
    });
  });

  describe("POST /api/checkout/:id/quote", () => {
    it("quotes the link", async () => {
      const res = await post(`/api/checkout/${link.id}/quote`, {
        chainId: chain.chain.id,
        sourceTokenAddress: USDC,
      });

      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({
        appId,
        paymentLinkId: link.id,
        sourceAmount: "25000000",
      });
    });

    it("quotes a registered non-settlement pay-in token", async () => {
      const weth = await createToken(chain.chain.id, {
        address: WETH,
        symbol: "WETH",
        decimals: 18,
      });
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: -195000, liquidity: 1n },
      ]);

      const res = await post(`/api/checkout/${link.id}/quote`, {
        chainId: chain.chain.id,
        sourceTokenAddress: WETH,
      });

      expect(res.status).toBe(201);
      expect(res.json.sourceTokenId).toBe(weth.id);
      expect(res.json.targetTokenId).toBe(chain.usdc.id);
    });

    it("quotes a token a payer imported without listing it", async () => {
      const imported = await createToken(chain.chain.id, {
        address: WETH,
        symbol: "WETH",
        decimals: 18,
        listed: false,
      });
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: -195000, liquidity: 1n },
      ]);

      const checkout = await get(`/api/checkout/${link.id}`);
      expect(
        checkout.json.chains[0].tokens.map((t: { symbol: string }) => t.symbol),
      ).toEqual(["USDC"]);

      const res = await post(`/api/checkout/${link.id}/quote`, {
        chainId: chain.chain.id,
        sourceTokenAddress: WETH,
      });

      expect(res.status).toBe(201);
      expect(res.json.sourceTokenId).toBe(imported.id);
    });
  });

  describe("POST /api/checkout/:id/transfer", () => {
    const quote = async (sourceTokenAddress: string) => {
      const res = await post(`/api/checkout/${link.id}/quote`, {
        chainId: chain.chain.id,
        sourceTokenAddress,
      });
      expect(res.status).toBe(201);
      return res.json;
    };

    it("opens a transfer to be paid in the settlement token", async () => {
      const res = await post(`/api/checkout/${link.id}/transfer`, {
        quoteId: (await quote(USDC)).id,
        refundAddress: PAYER,
      });

      expect(res.status).toBe(201);
      expect(res.json.paymentInstructions).toMatchObject({
        address: res.json.payinAddress,
        tokenAddress: USDC,
        amount: "25000000",
      });
      expect(res.json.refundAddress.toLowerCase()).toBe(PAYER.toLowerCase());
    });

    it("opens a transfer for a selected non-settlement token", async () => {
      await createToken(chain.chain.id, {
        address: WETH,
        symbol: "WETH",
        decimals: 18,
      });
      stubPools([
        { tokens: [WETH, USDC], fee: 500, tick: -195000, liquidity: 1n },
      ]);

      const res = await post(`/api/checkout/${link.id}/transfer`, {
        quoteId: (await quote(WETH)).id,
        refundAddress: PAYER,
      });

      expect(res.status).toBe(201);
      expect(res.json.paymentInstructions.tokenAddress).toBe(WETH);
    });
  });

  describe("POST /api/checkout/:id/transfer/:transferId/cancel", () => {
    const cancel = (transferId: string, paymentLinkId = link.id) =>
      call(
        "POST",
        `/api/checkout/${paymentLinkId}/transfer/${transferId}/cancel`,
        {},
      );
    const statusOf = async (transferId: string) =>
      (
        await db.query.transfer.findFirst({
          where: eq(transferTable.id, transferId),
        })
      )?.status;

    it("cancels a transfer nobody has paid", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
      });

      const res = await cancel(row.id);

      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ id: row.id, status: "Cancelled" });
      expect(await statusOf(row.id)).toBe(TransferStatus.Cancelled);
    });

    it("leaves a transfer alone once a payment has arrived", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
      });
      fakeActor.getBalance.mockResolvedValue(25_000_000n);

      const res = await cancel(row.id);

      expect(res.status).toBe(409);
      expect(res.json.error.message).toBe(
        "A payment has already arrived for this transfer",
      );
      expect(await statusOf(row.id)).toBe(TransferStatus.AwaitingDeposit);
    });

    it("only cancels a transfer still awaiting its deposit", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
        status: TransferStatus.Settled,
      });

      expect((await cancel(row.id)).status).toBe(409);
      expect(await statusOf(row.id)).toBe(TransferStatus.Settled);
    });

    it("doesn't cancel an x402 offer", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
      });
      await db
        .update(transferTable)
        .set({ x402Offer: true })
        .where(eq(transferTable.id, row.id));

      expect((await cancel(row.id)).status).toBe(409);
      expect(await statusOf(row.id)).toBe(TransferStatus.AwaitingDeposit);
    });

    it("can't cancel another link's transfer", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(otherLink.id),
      });

      const res = await cancel(row.id);

      expect(res.status).toBe(404);
      expect(res.json.error.message).not.toBe("Route not found");
      expect(await statusOf(row.id)).toBe(TransferStatus.AwaitingDeposit);
    });
  });

  it("does not expose the superseded checkout payment routes", async () => {
    const pay = await post(`/api/checkout/${link.id}/pay`, {
      chainId: chain.chain.id,
      sourceTokenAddress: USDC,
    });
    const create = await post(`/api/checkout/${link.id}/x402`, {
      quoteId: crypto.randomUUID(),
    });
    const settle = await post(`/api/checkout/${link.id}/x402/settle`, {});

    expect(pay.status).toBe(404);
    expect(create.status).toBe(404);
    expect(settle.status).toBe(404);
  });

  describe("GET /pay/:id for x402 clients", () => {
    const agent = (id: string, headers: Record<string, string> = {}) =>
      call("GET", `/pay/${id}`, { accept: "*/*", ...headers });

    const challengeFor = async (id: string) => {
      const response = await agent(id);
      expect(response.status).toBe(402);
      return decodePaymentRequiredHeader(
        response.headers.get("PAYMENT-REQUIRED")!,
      );
    };

    const sign = (
      required: Awaited<ReturnType<typeof challengeFor>>,
      nonce = "11",
    ) => {
      const accepted = required.accepts[0];

      return encodePaymentSignatureHeader({
        x402Version: 2,
        resource: required.resource,
        accepted,
        payload: {
          signature: `0x${nonce.repeat(65)}`,
          authorization: {
            from: PAYER,
            to: accepted.payTo,
            value: accepted.amount,
            validAfter: "0",
            validBefore: String(
              Math.floor(Date.now() / 1000) + accepted.maxTimeoutSeconds,
            ),
            nonce: `0x${nonce.repeat(32)}`,
          },
        },
      });
    };

    it("answers the link itself with a challenge", async () => {
      const response = await agent(link.id);

      expect(response.status).toBe(402);
      const required = decodePaymentRequiredHeader(
        response.headers.get("PAYMENT-REQUIRED")!,
      );
      expect(required).toMatchObject({
        x402Version: 2,
        resource: {
          url: `http://localhost:3000/pay/${link.id}`,
          description: "Pro plan",
        },
      });
      expect(required.accepts).toEqual([
        expect.objectContaining({
          scheme: "exact",
          network: chain.chain.caip2Id,
          asset: USDC,
          amount: "25000000",
          extra: { name: "USD Coin", version: "2" },
        }),
      ]);
      expect(response.json).toEqual(required);
    });

    it("leaves browsers to the checkout page", async () => {
      const response = await call("GET", `/pay/${link.id}`, {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      });

      expect(response.status).not.toBe(402);
      expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
    });

    it("offers every network that takes x402", async () => {
      const optimism = await createConfiguredChain("eip155:10");
      await acceptChain(appId, optimism.chain.id);

      const required = await challengeFor(link.id);

      expect(
        required.accepts.map((accepted) => accepted.network).sort(),
      ).toEqual([chain.chain.caip2Id, optimism.chain.caip2Id].sort());
    });

    it("offers networks without a gas sponsor, where the operator pays gas", async () => {
      const optimism = await createConfiguredChain("eip155:10");
      await acceptChain(appId, optimism.chain.id);
      await db
        .update(chainConfigTable)
        .set({ gasSponsorProviders: [] })
        .where(eq(chainConfigTable.chainId, optimism.chain.id));

      const required = await challengeFor(link.id);

      expect(required.accepts.map((accepted) => accepted.network)).toContain(
        optimism.chain.caip2Id,
      );
    });

    it("leaves out networks the app doesn't take payments on", async () => {
      await createConfiguredChain("eip155:10");

      const required = await challengeFor(link.id);

      expect(required.accepts.map((accepted) => accepted.network)).toEqual([
        chain.chain.caip2Id,
      ]);
    });

    it("reuses an open offer instead of opening a transfer per request", async () => {
      const first = await challengeFor(link.id);
      const second = await challengeFor(link.id);

      expect(second.accepts[0].payTo).toBe(first.accepts[0].payTo);
      expect(await db.$count(transferTable)).toBe(1);
    });

    it("makes a new offer once the link changes", async () => {
      const first = await challengeFor(link.id);
      await db
        .update(paymentLinkTable)
        .set({ amount: "30", updatedAt: new Date(Date.now() + 1000) })
        .where(eq(paymentLinkTable.id, link.id));

      const second = await challengeFor(link.id);

      expect(second.accepts[0].payTo).not.toBe(first.accepts[0].payTo);
      expect(second.accepts[0].amount).toBe("30000000");
    });

    it("settles a signed retry of the same request", async () => {
      await db
        .update(paymentLinkTable)
        .set({ usage: PaymentLinkUsage.Reusable })
        .where(eq(paymentLinkTable.id, link.id));

      const required = await challengeFor(link.id);
      const paid = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required),
      });

      expect(paid.status).toBe(200);
      expect(
        decodePaymentResponseHeader(paid.headers.get("PAYMENT-RESPONSE")!),
      ).toMatchObject({ success: true, transaction: "0xsettled" });
      expect(paid.json).toMatchObject({
        paymentLinkId: link.id,
        merchant: { name: "Shop" },
        title: "Pro plan",
        amount: "25.000000000000000000",
        currency: "USD",
        transaction: "0xsettled",
        status: `http://localhost:3000/api/checkout/${link.id}/transfer/${paid.json.transferId}`,
        returnUrl: null,
      });

      const row = await db.query.transfer.findFirst({
        where: eq(transferTable.id, paid.json.transferId),
      });
      expect(row?.status).toBe(TransferStatus.x402Settled);

      const next = await challengeFor(link.id);
      expect(next.accepts[0].payTo).not.toBe(required.accepts[0].payTo);
    });

    it("hands the agent the merchant's return URL once paid", async () => {
      await db
        .update(paymentLinkTable)
        .set({ returnUrl: "https://shop.example/thanks?order=42" })
        .where(eq(paymentLinkTable.id, link.id));
      const required = await challengeFor(link.id);

      const paid = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required),
      });

      expect(paid.status).toBe(200);
      expect(paid.json.returnUrl).toBe(
        `https://shop.example/thanks?order=42&status=completed&transferId=${paid.json.transferId}`,
      );
    });

    it("can be paid by a stock x402 client", async () => {
      // Out of the box, x402 clients only pay well-known assets such as USDC.
      await db
        .update(tokenTable)
        .set({ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" })
        .where(eq(tokenTable.id, chain.usdc.id));
      const payer = privateKeyToAccount(generatePrivateKey());
      const http = new x402HTTPClient(
        registerExactEvmScheme(
          new x402Client().setSpendControls({ maxAmountPerPayment: "$50" }),
          { signer: payer },
        ),
      );

      const first = await agent(link.id);
      const required = http.getPaymentRequiredResponse(
        (name) => first.headers.get(name),
        first.json,
      );
      const payment = await http.createPaymentPayload(required);
      expect(payment.payload.authorization).toMatchObject({
        from: payer.address,
        to: required.accepts[0].payTo,
        value: "25000000",
      });

      const paid = await agent(
        link.id,
        http.encodePaymentSignatureHeader(payment),
      );

      expect(paid.status).toBe(200);
      expect(
        http.getPaymentSettleResponse((name) => paid.headers.get(name)),
      ).toMatchObject({ success: true });
    });

    it("offers fresh terms when the signed ones were taken", async () => {
      await db
        .update(paymentLinkTable)
        .set({ usage: PaymentLinkUsage.Reusable })
        .where(eq(paymentLinkTable.id, link.id));
      const required = await challengeFor(link.id);
      await agent(link.id, { "PAYMENT-SIGNATURE": sign(required, "11") });

      const late = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required, "22"),
      });

      expect(late.status).toBe(402);
      const fresh = decodePaymentRequiredHeader(
        late.headers.get("PAYMENT-REQUIRED")!,
      );
      expect(fresh.error).toBeTruthy();
      expect(fresh.accepts[0].payTo).not.toBe(required.accepts[0].payTo);
    });

    it("stops taking payments on a one-time link once an agent has paid it", async () => {
      const required = await challengeFor(link.id);
      const paid = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required, "11"),
      });
      expect(paid.status).toBe(200);

      const late = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required, "22"),
      });
      const next = await agent(link.id);

      for (const response of [late, next]) {
        expect(response.status).toBe(409);
        expect(response.json.error.message).toBe(
          "Payment link has already been used",
        );
      }
      expect(facilitator.settle).toHaveBeenCalledTimes(1);
    });

    it("doesn't reuse an offer once its reservation is released", async () => {
      facilitator.settle.mockRejectedValue(new Error("rpc down"));
      vi.spyOn(fakeActor, "publicClient").mockResolvedValue({
        multicall: vi
          .fn()
          .mockResolvedValue([
            { result: "USD Coin" },
            { result: "2" },
            { result: false },
          ]),
        readContract: vi.fn().mockResolvedValue(false),
      } as never);
      const required = await challengeFor(link.id);
      const { payTo } = required.accepts[0];

      // the app's error handler logs the failure; keep it out of the test output
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const failed = await agent(link.id, {
          "PAYMENT-SIGNATURE": sign(required),
        });

        expect(failed.status).toBe(500);
        expect(consoleError).toHaveBeenCalledWith(
          expect.objectContaining({ message: "rpc down" }),
        );
      } finally {
        consoleError.mockRestore();
      }

      const released = await db.query.transfer.findFirst({
        where: eq(transferTable.payinAddress, payTo),
      });
      expect(released).toMatchObject({
        status: TransferStatus.AwaitingDeposit,
        x402AuthorizationNonce: null,
      });

      const next = await challengeFor(link.id);
      expect(next.accepts[0].payTo).not.toBe(payTo);
    });

    it("re-challenges a payment the facilitator rejects", async () => {
      facilitator.verify.mockResolvedValueOnce({
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_signature",
        invalidMessage: "Bad signature",
      });
      const required = await challengeFor(link.id);

      const rejected = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required),
      });

      expect(rejected.status).toBe(402);
      expect(
        decodePaymentRequiredHeader(rejected.headers.get("PAYMENT-REQUIRED")!),
      ).toMatchObject({ error: "Bad signature" });
    });

    it("answers 402 with the pending settlement when it isn't confirmed", async () => {
      const pending = {
        success: false,
        errorReason: "settlement_pending",
        transaction: "",
        network: chain.chain.caip2Id,
      };
      facilitator.settle.mockResolvedValue(pending);
      vi.spyOn(fakeActor, "publicClient").mockResolvedValue({
        multicall: vi
          .fn()
          .mockResolvedValue([
            { result: "USD Coin" },
            { result: "2" },
            { result: false },
          ]),
        readContract: vi.fn().mockRejectedValue(new Error("rpc down")),
      } as never);
      const required = await challengeFor(link.id);

      const response = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required),
      });

      expect(response.status).toBe(402);
      expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
      expect(
        decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE")!),
      ).toMatchObject({ success: false, errorReason: "settlement_pending" });
    });

    const startPendingPayment = async () => {
      facilitator.settle.mockResolvedValue({
        success: false,
        errorReason: "settlement_pending",
        transaction: "",
        network: chain.chain.caip2Id,
      });
      const readContract = vi.fn().mockRejectedValue(new Error("rpc down"));
      vi.spyOn(fakeActor, "publicClient").mockResolvedValue({
        multicall: vi
          .fn()
          .mockResolvedValue([
            { result: "USD Coin" },
            { result: "2" },
            { result: false },
          ]),
        readContract,
      } as never);
      const required = await challengeFor(link.id);
      const signature = sign(required);

      const pending = await agent(link.id, { "PAYMENT-SIGNATURE": signature });
      expect(pending.status).toBe(402);

      return { payTo: required.accepts[0].payTo, signature, readContract };
    };

    it("still settles a payment that was pending when the one-time link got used", async () => {
      const { payTo, signature, readContract } = await startPendingPayment();
      await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
        status: TransferStatus.Cancelled,
      });
      readContract.mockResolvedValue(true);
      await createDepositRow({
        address: payTo,
        chainId: chain.chain.id,
        tokenId: chain.usdc.id,
        sender: PAYER,
        amount: 25_000_000n,
        hash: "0xlanded",
      });

      const paid = await agent(link.id, { "PAYMENT-SIGNATURE": signature });

      expect(paid.status).toBe(200);
      expect(paid.json).toMatchObject({
        paymentLinkId: link.id,
        transaction: "0xlanded",
      });
    });

    it("refuses a retry that never landed once the one-time link is used", async () => {
      const { payTo, signature, readContract } = await startPendingPayment();
      await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
        status: TransferStatus.Cancelled,
      });
      readContract.mockResolvedValue(false);
      await db
        .update(transferTable)
        .set({ x402LeaseExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(transferTable.payinAddress, payTo));

      const retried = await agent(link.id, { "PAYMENT-SIGNATURE": signature });

      expect(retried.status).toBe(409);
      expect(retried.json.error.message).toBe(
        "Payment link has already been used",
      );
      expect(facilitator.settle).toHaveBeenCalledTimes(1);
    });

    it("refuses a link no network can take x402 for", async () => {
      await db
        .update(tokenTable)
        .set({ supportsEIP3009: false, version: null })
        .where(eq(tokenTable.id, chain.usdc.id));

      const response = await agent(link.id);

      expect(response.status).toBe(409);
      expect(response.json.error.code).toBe("PreconditionFailed");
    });

    it("doesn't take a payment for an offer once a one-time link has been paid", async () => {
      const required = await challengeFor(link.id);
      await createTransferRow({
        appId,
        quote: await quoteFor(link.id),
        status: TransferStatus.Settled,
      });

      const response = await agent(link.id, {
        "PAYMENT-SIGNATURE": sign(required),
      });

      expect(response.status).toBe(409);
      expect(response.json.error.message).toBe(
        "Payment link has already been used",
      );
      expect(facilitator.verify).not.toHaveBeenCalled();
      expect(facilitator.settle).not.toHaveBeenCalled();
    });

    it("re-challenges a version 1 payment", async () => {
      const response = await agent(link.id, {
        "PAYMENT-SIGNATURE": Buffer.from(
          JSON.stringify({
            x402Version: 1,
            scheme: "exact",
            network: "base",
            payload: {},
          }),
        ).toString("base64"),
      });

      expect(response.status).toBe(402);
      expect(
        decodePaymentRequiredHeader(response.headers.get("PAYMENT-REQUIRED")!),
      ).toMatchObject({ error: "Only x402 version 2 payments are accepted" });
    });

    it("is 404 for an unknown link", async () => {
      const response = await agent(crypto.randomUUID());

      expect(response.status).toBe(404);
    });
  });

  describe("quotes and transfers of another link", () => {
    it("can't be paid through this link", async () => {
      const quote = await quoteFor(otherLink.id);

      const transfer = await post(`/api/checkout/${link.id}/transfer`, {
        quoteId: quote.id,
        refundAddress: address(0x7e7),
      });

      expect(transfer.status).toBe(404);
      expect(transfer.json.error.message).not.toBe("Route not found");
    });

    it("can't be tracked through this link", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(otherLink.id),
      });

      const tracked = await get(`/api/checkout/${link.id}/transfer/${row.id}`);
      expect(tracked.status).toBe(404);
      expect(tracked.json.error.message).not.toBe("Route not found");
    });
  });

  it("tracks a transfer made from the link", async () => {
    const row = await createTransferRow({
      appId,
      quote: await quoteFor(link.id),
    });

    const res = await get(`/api/checkout/${link.id}/transfer/${row.id}`);

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: row.id,
      status: "AwaitingDeposit",
      payinAddress: row.payinAddress,
    });

    expect(res.json.kiteTransferInput).toBeUndefined();
  });

  describe("usage", () => {
    const paid = async (paymentLinkId: string) => {
      return createTransferRow({
        appId,
        quote: await quoteFor(paymentLinkId),
        status: TransferStatus.Settled,
      });
    };

    const requestQuote = (paymentLinkId: string) => {
      return post(`/api/checkout/${paymentLinkId}/quote`, {
        chainId: chain.chain.id,
        sourceTokenAddress: USDC,
      });
    };

    const requestOffer = (paymentLinkId: string) => {
      return call("GET", `/pay/${paymentLinkId}`, { accept: "*/*" });
    };

    it("closes a one-time link once a transfer from it has settled", async () => {
      const settled = await paid(link.id);

      for (const res of [
        await get(`/api/checkout/${link.id}`),
        await requestQuote(link.id),
        await requestOffer(link.id),
      ]) {
        expect(res.status).toBe(409);
        expect(res.json.error).toMatchObject({
          code: "PreconditionFailed",
          message: "Payment link has already been used",
        });
      }

      const tracked = await get(
        `/api/checkout/${link.id}/transfer/${settled.id}`,
      );
      expect(tracked.status).toBe(200);
      expect(tracked.json.status).toBe("Settled");
    });

    it("won't open a transfer from a quote made before the link was paid", async () => {
      const quoted = await requestQuote(link.id);
      expect(quoted.status).toBe(201);
      await paid(link.id);

      const res = await post(`/api/checkout/${link.id}/transfer`, {
        quoteId: quoted.json.id,
        refundAddress: PAYER,
      });

      expect(res.status).toBe(409);
      expect(res.json.error.message).toBe("Payment link has already been used");
      expect(await db.$count(transferTable)).toBe(1);
    });

    it("keeps a reusable link open after it has been paid", async () => {
      const reusable = await createPaymentLink(appId, {
        amount: "25",
        usage: PaymentLinkUsage.Reusable,
      });
      await paid(reusable.id);

      const page = await get(`/api/checkout/${reusable.id}`);
      expect(page.status).toBe(200);
      expect(page.json.paymentLink.usage).toBe("Reusable");

      const quoted = await requestQuote(reusable.id);
      expect(quoted.status).toBe(201);

      const opened = await post(`/api/checkout/${reusable.id}/transfer`, {
        quoteId: quoted.json.id,
        refundAddress: PAYER,
      });
      expect(opened.status).toBe(201);

      expect((await requestOffer(reusable.id)).status).toBe(402);
    });
  });
});

describe("payment link currencies", () => {
  let api: ReturnType<typeof client>;

  beforeEach(async () => {
    const appId = (await createApp()).id;
    const { chain } = await createConfiguredChain();

    api = client(rootCredentials(appId));

    await db.insert(priceFeed).values([
      {
        chainId: chain.id,
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        address: address(0xe0),
        decimals: 8,
      },
      {
        chainId: chain.id,
        baseCurrency: "ETH",
        quoteCurrency: "BTC",
        address: address(0xe1),
        decimals: 8,
      },
    ]);
  });

  it("lists USD and every currency with a USD feed", async () => {
    const res = await api.get("/api/payment-links/currencies");

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: ["USD", "EUR"] });
  });

  it("only creates or updates links in those currencies", async () => {
    const created = await api.post("/api/payment-links", {
      title: "Plan",
      currency: "eur",
      amount: "10",
    });

    expect(created.status).toBe(201);
    expect(created.json.currency).toBe("EUR");

    const rejected = await api.post("/api/payment-links", {
      title: "Plan",
      currency: "ETH",
      amount: "10",
    });

    expect(rejected.status).toBe(422);

    const updated = await api.patch(`/api/payment-links/${created.json.id}`, {
      currency: "GBP",
    });
    expect(updated.status).toBe(422);
  });
});
