import {
  createApiKey,
  createApp,
  createChain,
  createConfiguredChain,
  createCustomer,
  createFee,
  createPaymentLink,
  createToken,
  address,
  USDC,
  WETH,
} from "../../../test/factories";
import {
  WebhookCategory,
  ApiKeyScope,
  FeeType,
  TransferStatus,
} from "../../../shared/constants";
import { call, client, rootCredentials } from "../../../test/api";
import { fakeActor, operatorAddress, resetMocks } from "../../../test/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQuoteRow, payinFor } from "../../../test/transfers";
import { ChainService } from "../../../services/Chain.service";
import { transfer } from "../../../db/schema";
import { common } from "../../../shared/common";
import { kite } from "../../../shared/kiteContract";
import { db } from "../../../db";
import { eq } from "drizzle-orm";

vi.mock("../../../shared/providers", () => ({
  runProviderMethod: vi.fn(async () => undefined),
  isProviderConfiguredForAction: vi.fn(),
  getProvider: vi.fn(),
  ProvidersMap: {},
}));

const REFUND_TO = address(0x7e7);

describe("API resources", () => {
  let appId: string;
  let chainId: string;
  let usdcId: string;
  let key: Awaited<ReturnType<typeof createApiKey>>;
  let api: ReturnType<typeof client>;

  beforeEach(async () => {
    resetMocks();
    vi.spyOn(kite, "predictAddress").mockImplementation(
      async (_client, _factory, struct) => {
        return payinFor(common.bytes32ToUuid(struct.id)!);
      },
    );

    vi.spyOn(kite, "simulateFactoryCall").mockResolvedValue({
      ok: true,
    });

    fakeActor.publicClient.mockResolvedValue({});

    const app = await createApp({
      name: "Test app",
    });

    appId = app.id;

    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    usdcId = configured.usdc.id;

    key = await createApiKey(appId, {
      scopes: Object.values(ApiKeyScope),
    });

    api = client(key.credentials);
  });

  describe("chains and tokens", () => {
    it("lists configured chains without any configuration secrets", async () => {
      const res = await api.get("/api/chains");

      expect(res.status).toBe(200);
      expect(res.json.data).toHaveLength(1);
      expect(res.json.data[0]).toMatchObject({
        id: chainId,
        caip2Id: "eip155:8453",
        name: "Base",
        settlementToken: {
          id: usdcId,
          symbol: "USDC",
        },
        usdPeggedToken: {
          id: usdcId,
        },
      });
      expect(JSON.stringify(res.json)).not.toMatch(
        /rpcUrls|kiteFactoryAddress|providers/i,
      );
    });

    it("hides inactive and unconfigured chains", async () => {
      const inactive = await createConfiguredChain("eip155:10");
      await new ChainService().updateChainActiveStatus(
        inactive.chain.id,
        false,
      );

      await createChain("eip155:1");

      const res = await api.get("/api/chains");
      expect(res.json.data.map((c: any) => c.caip2Id)).toEqual(["eip155:8453"]);
    });

    it("lists tokens and finds one by address", async () => {
      await createToken(chainId, {
        address: WETH,
        symbol: "WETH",
      });

      const list = await api.get("/api/tokens", { chainId, q: "weth" });

      expect(list.json.total).toBe(1);

      const one = await api.get(`/api/tokens/${chainId}/${WETH.toLowerCase()}`);

      expect(one.status).toBe(200);
      expect(one.json).toMatchObject({
        address: WETH,
        symbol: "WETH",
      });
    });

    it("finds a token by address without credentials", async () => {
      await createToken(chainId, {
        address: WETH,
        symbol: "WETH",
      });

      const one = await call(
        "GET",
        `/api/tokens/${chainId}/${WETH.toLowerCase()}`,
        {},
      );

      expect(one.status).toBe(200);
      expect(one.json).toMatchObject({
        address: WETH,
        symbol: "WETH",
      });

      expect((await call("GET", "/api/tokens", {})).status).toBe(401);
    });

    it("lists a looked-up token only for the root key", async () => {
      await createToken(chainId, {
        address: WETH,
        symbol: "WETH",
        listed: false,
      });

      const path = `/api/tokens/${chainId}/${WETH.toLowerCase()}`;
      const root = client(rootCredentials());
      const symbols = async () =>
        (await root.get("/api/tokens", { chainId })).json.data.map(
          (t: { symbol: string }) => t.symbol,
        );

      expect((await call("GET", path, {})).json.listed).toBe(false);
      expect(await symbols()).not.toContain("WETH");

      const wrongKey = await call("GET", path, {
        "x-kite-root-key": "not-the-root-key-123",
      });
      expect(wrongKey.status).toBe(401);

      expect((await root.get(path)).json.listed).toBe(true);
      expect(await symbols()).toContain("WETH");
    });

    it("rejects a malformed token address", async () => {
      const res = await api.get(`/api/tokens/${chainId}/0x123`);
      expect(res.status).toBe(422);
    });
  });

  describe("customers", () => {
    it("creates, updates by external id, reads and deletes", async () => {
      const created = await api.post("/api/customers", {
        externalId: "u-1",
        name: "Ada",
        traits: { plan: "pro" },
      });

      expect(created.status).toBe(200);

      const again = await api.post("/api/customers", {
        externalId: "u-1",
        name: "Ada L",
      });

      expect(again.json.id).toBe(created.json.id);
      expect(again.json).toMatchObject({
        name: "Ada L",
        traits: { plan: "pro" },
      });

      const res1 = await api.get(`/api/customers/${created.json.id}`);
      const res2 = await api.get("/api/customers", {
        externalId: "u-1",
      });

      const res3 = await api.delete(`/api/customers/${created.json.id}`);
      const res4 = await api.get(`/api/customers/${created.json.id}`);

      expect(res1.json.externalId).toBe("u-1");
      expect(res2.json.total).toBe(1);

      expect(res3.status).toBe(200);
      expect(res4.status).toBe(404);
    });

    it("shows the whole customer, traits included", async () => {
      const customer = await createCustomer(appId, {
        traits: { tier: "gold" },
      });

      const res = await api.get(`/api/customers/${customer.id}`);

      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        id: customer.id,
        traits: { tier: "gold" },
      });
    });

    it("keeps customers inside their app", async () => {
      const app = await createApp();
      const foreign = await createCustomer(app.id);

      const res1 = await api.get(`/api/customers/${foreign.id}`);
      const res2 = await api.delete(`/api/customers/${foreign.id}`);

      expect(res1.status).toBe(404);
      expect(res2.status).toBe(404);
    });

    it("lets the root key read a customer without naming the app", async () => {
      const customer = await createCustomer(appId);
      const res = await client(rootCredentials()).get(
        `/api/customers/${customer.id}`,
      );

      expect(res.status).toBe(200);
    });
  });

  describe("fees", () => {
    const feeBody = (overrides: Record<string, unknown> = {}) => ({
      chainId,
      label: "Platform",
      type: FeeType.Variable,
      value: "30",
      condition: {},
      ...overrides,
    });

    it("creates app fees and returns amounts as strings", async () => {
      const res = await api.post(
        "/api/fees",
        feeBody({
          minAmountToCharge: "100",
          maxAmountToCharge: "50000",
        }),
      );

      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({
        appId,
        value: "30",
        minAmountToCharge: "100",
        maxAmountToCharge: "50000",
      });
    });

    it("shows system fees to apps, read-only", async () => {
      const system = await createFee(chainId, {
        appId: null,
        label: "System",
      });

      const list = await api.get("/api/fees");
      expect(list.json.data.map((f: { id: string }) => f.id)).toEqual([
        system.id,
      ]);

      const res1 = await api.get(`/api/fees/${system.id}`);
      const res2 = await api.patch(`/api/fees/${system.id}`, { label: "x" });
      const res3 = await api.delete(`/api/fees/${system.id}`);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(404);
      expect(res3.status).toBe(404);
    });

    it("lets the root key manage system fees when it names no app", async () => {
      const root = client(rootCredentials());
      const created = await root.post(
        "/api/fees",
        feeBody({ label: "Network" }),
      );

      expect(created.json.appId).toBeNull();

      const asApp = await root.patch(`/api/fees/${created.json.id}`, {
        label: "Renamed",
      });

      expect(asApp.json.label).toBe("Renamed");

      const appFees = await client(rootCredentials(appId)).get("/api/fees");
      expect(appFees.json.total).toBe(1);

      expect((await root.delete(`/api/fees/${created.json.id}`)).status).toBe(
        200,
      );
    });

    it("updates and deletes app fees", async () => {
      const created = await api.post("/api/fees", feeBody());
      const updated = await api.patch(`/api/fees/${created.json.id}`, {
        value: "50",
        condition: { sourceAmount: { _gte: "1000000" } },
      });

      expect(updated.json).toMatchObject({
        value: "50",
        condition: { sourceAmount: { _gte: "1000000" } },
      });

      const res1 = await api.delete(`/api/fees/${created.json.id}`);
      const res2 = await api.get(`/api/fees/${created.json.id}`);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(404);
    });

    it.each([
      ["a variable fee above 100%", { value: "10001" }, 400],
      ["a negative value", { value: "-1" }, 422],
      [
        "an unknown condition key",
        { condition: { country: { _eq: "NG" } } },
        422,
      ],
      [
        "an unknown condition operator",
        { condition: { customer: { id: { _like: "x" } } } },
        422,
      ],
      ["an unknown chain", { chainId: crypto.randomUUID() }, 409],
    ])("rejects %s", async (_label, overrides, status) => {
      const res = await api.post("/api/fees", feeBody(overrides));

      expect(res.status).toBe(status);
    });

    it("accepts conditions on customer traits and currencies", async () => {
      const res = await api.post(
        "/api/fees",
        feeBody({
          condition: {
            customer: { "traits.plan": { _in: ["pro", "team"] } },
            sourceCurrency: { contractAddress: { _eq: USDC } },
            sourceAmount: { _lt: "5000000" },
          },
        }),
      );

      expect(res.status).toBe(201);
    });
  });

  describe("payment links and quotes", () => {
    const linkBody = {
      title: "Pro plan",
      currency: "usd",
      amount: "10",
    };

    it("manages payment links", async () => {
      const created = await api.post("/api/payment-links", linkBody);
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        currency: "USD",
        amount: "10.000000000000000000",
      });

      const updated = await api.patch(`/api/payment-links/${created.json.id}`, {
        amount: "12.5",
      });

      expect(updated.json.amount).toBe("12.500000000000000000");

      const res1 = await api.get("/api/payment-links", { q: "pro" });
      const res2 = await api.delete(`/api/payment-links/${created.json.id}`);
      const res3 = await api.get(`/api/payment-links/${created.json.id}`);

      expect(res1.json.total).toBe(1);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(404);
    });

    it("keeps the merchant's reference and meta, one link per reference", async () => {
      const created = await api.post("/api/payment-links", {
        ...linkBody,
        reference: "order-1",
        meta: { cart: "c-9" },
      });

      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        reference: "order-1",
        meta: { cart: "c-9" },
      });

      await api.post("/api/payment-links", linkBody);
      const found = await api.get("/api/payment-links", {
        reference: "order-1",
      });

      expect(found.json.data.map((link: { id: string }) => link.id)).toEqual([
        created.json.id,
      ]);

      const again = await api.post("/api/payment-links", {
        ...linkBody,
        reference: "order-1",
      });

      expect(again.status).toBe(409);

      const checkout = await call(
        "GET",
        `/api/checkout/${created.json.id}`,
        {},
      );
      expect(checkout.json.paymentLink).not.toHaveProperty("reference");
      expect(checkout.json.paymentLink).not.toHaveProperty("meta");
    });

    it("keeps a return URL the checkout can send the payer to", async () => {
      const returnUrl = "https://shop.example/orders/42?from=kite";
      const created = await api.post("/api/payment-links", {
        ...linkBody,
        returnUrl,
      });

      expect(created.status).toBe(201);
      expect(created.json.returnUrl).toBe(returnUrl);

      const checkout = await call(
        "GET",
        `/api/checkout/${created.json.id}`,
        {},
      );
      expect(checkout.json.paymentLink.returnUrl).toBe(returnUrl);

      const cleared = await api.patch(`/api/payment-links/${created.json.id}`, {
        returnUrl: null,
      });
      expect(cleared.json.returnUrl).toBeNull();
    });

    it("makes links one-time unless asked for a reusable one", async () => {
      const oneTime = await api.post("/api/payment-links", linkBody);
      const reusable = await api.post("/api/payment-links", {
        ...linkBody,
        usage: "Reusable",
      });

      expect(oneTime.status).toBe(201);
      expect(oneTime.json.usage).toBe("OneTime");
      expect(reusable.status).toBe(201);
      expect(reusable.json.usage).toBe("Reusable");

      const switched = await api.patch(
        `/api/payment-links/${oneTime.json.id}`,
        { usage: "Reusable" },
      );
      expect(switched.status).toBe(200);
      expect(switched.json.usage).toBe("Reusable");

      const read = await api.get(`/api/payment-links/${oneTime.json.id}`);
      expect(read.json.usage).toBe("Reusable");
    });

    it("rejects an unknown usage", async () => {
      const created = await api.post("/api/payment-links", {
        ...linkBody,
        usage: "Twice",
      });
      expect(created.status).toBe(422);

      const link = await createPaymentLink(appId);
      const updated = await api.patch(`/api/payment-links/${link.id}`, {
        usage: "Twice",
      });
      expect(updated.status).toBe(422);
    });

    it.each(["javascript:alert(1)", "ftp://shop.example", "/orders/42"])(
      "rejects %s as a return URL",
      async (returnUrl) => {
        const res = await api.post("/api/payment-links", {
          ...linkBody,
          returnUrl,
        });

        expect(res.status).toBe(422);
      },
    );

    it("requires line items to add up to the amount", async () => {
      const lineItems = [
        { name: "Seat", price: "4.5", quantity: 2 },
        { name: "Setup", price: "1", quantity: 1 },
      ];

      const short = await api.post("/api/payment-links", {
        ...linkBody,
        amount: "12",
        lineItems,
      });
      expect(short.status).toBe(422);
      expect(short.json.error.message).toBe(
        "Line items add up to 10, but the amount is 12",
      );

      const created = await api.post("/api/payment-links", {
        ...linkBody,
        lineItems,
      });
      expect(created.status).toBe(201);

      const path = `/api/payment-links/${created.json.id}`;
      expect((await api.patch(path, { amount: "12" })).status).toBe(422);
      expect(
        (
          await api.patch(path, {
            amount: "12",
            lineItems: [{ name: "Seat", price: "6", quantity: 2 }],
          })
        ).status,
      ).toBe(200);
      expect((await api.patch(path, { lineItems: [] })).status).toBe(200);
    });

    it.each([
      ["a negative amount", { amount: "-1" }],
      ["too many decimals", { amount: "1.0000000000000000001" }],
    ])("rejects %s", async (_label, overrides) => {
      const res = await api.post("/api/payment-links", {
        ...linkBody,
        ...overrides,
      });

      expect(res.status).toBe(422);
    });

    it("reads a link and quotes it", async () => {
      const link = await createPaymentLink(appId, { amount: "10" });
      const read = await api.get(`/api/payment-links/${link.id}`);

      expect(read.json.id).toBe(link.id);

      const quoted = await api.post(`/api/payment-links/${link.id}/pay`, {
        chainId,
        sourceTokenAddress: USDC,
      });

      expect(quoted.status).toBe(201);
      expect(quoted.json).toMatchObject({
        paymentLinkId: link.id,
        sourceAmount: "10000000",
        targetAmount: "10000000",
      });

      const fetched = await api.get(`/api/quotes/${quoted.json.id}`);

      expect(fetched.json.sourceToken.symbol).toBe("USDC");
    });

    it("creates and lists quotes with a signature", async () => {
      const created = await api.post("/api/quotes", {
        chainId,
        sourceTokenAddress: USDC,
        amount: "2500000",
        reference: "order-1",
      });

      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        sourceAmount: "2500000",
        targetAmount: "2500000",
        reference: "order-1",
      });

      const list = await api.get("/api/quotes");
      expect(list.json.total).toBe(1);
      expect(list.json.data[0].chain.caip2Id).toBe("eip155:8453");
    });

    it("rejects malformed amounts", async () => {
      for (const amount of ["1.5", "-1", "abc", ""]) {
        const res = await api.post("/api/quotes", {
          chainId,
          sourceTokenAddress: USDC,
          amount,
        });

        expect(res.status).toBe(422);
      }
    });

    it("keeps quotes and payment links inside their app", async () => {
      const otherApp = await createApp();
      const foreignLink = await createPaymentLink(otherApp.id);
      const foreignQuote = await createQuoteRow({
        appId: otherApp.id,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });

      const res1 = await api.get(`/api/payment-links/${foreignLink.id}`);
      const res2 = await api.get(`/api/quotes/${foreignQuote.id}`);
      const res3 = await api.post(
        `/api/payment-links/${foreignLink.id}/quotes`,
        { chainId, sourceTokenAddress: USDC },
      );

      expect(res1.status).toBe(404);
      expect(res2.status).toBe(404);
      expect(res3.status).toBe(404);
    });
  });

  describe("transfers", () => {
    const quoteVia = async (paymentLinkId?: string) => {
      const link = paymentLinkId ? { paymentLinkId } : {};
      return createQuoteRow({
        appId,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
        ...link,
      });
    };

    it("opens a transfer for a quote and returns the payment instructions", async () => {
      const quote = await quoteVia();
      const res = await api.post("/api/transfers", {
        quoteId: quote.id,
        refundAddress: REFUND_TO,
      });

      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({
        status: "AwaitingDeposit",
        refundAddress: REFUND_TO,
        minAmountOut: "990000",
        paymentInstructions: {
          tokenAddress: USDC,
          amount: "1000000",
          address: res.json.payinAddress,
        },
      });

      const read = await api.get(`/api/transfers/${res.json.id}`);
      expect(read.json.quote.id).toBe(quote.id);

      const res1 = await api.get("/api/transfers", {
        status: "AwaitingDeposit",
      });

      const res2 = await api.get("/api/transfers", {
        status: "Settled",
      });

      expect(res1.json.total).toBe(1);
      expect(res2.json.total).toBe(0);
    });

    it("checks recovery balances and runs manual refund and recovery actions", async () => {
      const quote = await quoteVia();
      const created = await api.post("/api/transfers", {
        quoteId: quote.id,
        refundAddress: REFUND_TO,
      });

      fakeActor.getBalance.mockResolvedValue(25n);

      const balance = await api.post(
        `/api/transfers/${created.json.id}/recover/balance`,
        { tokenAddress: USDC },
      );
      expect(balance.status).toBe(200);
      expect(balance.json).toEqual({ balance: "25" });

      const recovery = await api.post(
        `/api/transfers/${created.json.id}/recover`,
        {
          tokenAddress: WETH,
          destinationAddress: REFUND_TO,
          useGasSponsor: false,
        },
      );
      expect(recovery.status).toBe(200);

      const refund = await api.post(
        `/api/transfers/${created.json.id}/refund`,
        { useGasSponsor: true },
      );
      expect(refund.status).toBe(200);
      expect(fakeActor.sendTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { useGasSponsor: false },
      );
    });

    it("refuses refunds and recoveries that can't happen, before sending anything", async () => {
      const quote = await quoteVia();
      const created = await api.post("/api/transfers", {
        quoteId: quote.id,
        refundAddress: REFUND_TO,
      });
      const id = created.json.id;

      const empty = await api.post(`/api/transfers/${id}/refund`, {});
      expect(empty.status).toBe(409);
      expect(empty.json.error.message).toMatch(/nothing to refund/);

      fakeActor.getBalance.mockResolvedValue(25n);

      const ownToken = await api.post(`/api/transfers/${id}/recover`, {
        tokenAddress: USDC,
        destinationAddress: REFUND_TO,
      });
      expect(ownToken.status).toBe(409);
      expect(ownToken.json.error.message).toMatch(/settling or refunding/);

      await db
        .update(transfer)
        .set({ status: TransferStatus.Refunded })
        .where(eq(transfer.id, id));

      const again = await api.post(`/api/transfers/${id}/refund`, {});
      expect(again.status).toBe(409);
      expect(again.json.error.message).toBe(
        "The transfer has already been refunded",
      );

      fakeActor.getBalance.mockResolvedValue(0n);
      const nothing = await api.post(`/api/transfers/${id}/recover`, {
        tokenAddress: USDC,
        destinationAddress: REFUND_TO,
      });
      expect(nothing.status).toBe(409);
      expect(nothing.json.error.message).toMatch(/nothing to recover/);

      expect(fakeActor.sendTransaction).not.toHaveBeenCalled();
    });

    it("opens and follows a transfer for a payment-link quote", async () => {
      const link = await createPaymentLink(appId);
      const quote = await quoteVia(link.id);
      const created = await api.post("/api/transfers", {
        quoteId: quote.id,
        refundAddress: REFUND_TO,
      });

      expect(created.status).toBe(201);

      const read = await api.get(`/api/transfers/${created.json.id}`);

      expect(read.status).toBe(200);
    });

    it("uses a quote once and rejects another app's quote", async () => {
      const quote = await quoteVia();
      const body = {
        quoteId: quote.id,
        refundAddress: REFUND_TO,
      };

      expect((await api.post("/api/transfers", body)).status).toBe(201);
      expect((await api.post("/api/transfers", body)).status).toBe(400);

      const app = await createApp();
      const foreign = await createQuoteRow({
        appId: app.id,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });

      const res = await api.post("/api/transfers", {
        quoteId: foreign.id,
        refundAddress: REFUND_TO,
      });

      expect(res.status).toBe(404);
    });

    it("rejects malformed refund addresses", async () => {
      const quote = await quoteVia();
      const res = await api.post("/api/transfers", {
        quoteId: quote.id,
        refundAddress: "0x123",
      });

      expect(res.status).toBe(422);
    });

    it("lets the root key list transfers across apps", async () => {
      const otherApp = await createApp();
      const otherQuote = await createQuoteRow({
        appId: otherApp.id,
        chainId,
        sourceTokenId: usdcId,
        targetTokenId: usdcId,
      });

      const mine = await quoteVia();

      await api.post("/api/transfers", {
        quoteId: mine.id,
        refundAddress: REFUND_TO,
      });

      await client(rootCredentials(otherApp.id)).post("/api/transfers", {
        quoteId: otherQuote.id,
        refundAddress: REFUND_TO,
      });

      const all = await client(rootCredentials()).get("/api/transfers");

      expect(all.json.total).toBe(2);
      expect(all.json.data.map((t: any) => t.appId).sort()).toEqual(
        [appId, otherApp.id].sort(),
      );

      expect((await api.get("/api/transfers")).json.total).toBe(1);
    });
  });

  describe("webhooks", () => {
    const body = {
      url: "https://example.com/hooks/kite",
      label: "main",
      categories: [WebhookCategory.Transfer, WebhookCategory.Deposit],
    };

    it("shows the signing key once, on creation", async () => {
      const created = await api.post("/api/webhooks", body);

      expect(created.status).toBe(201);
      expect(created.json.signingKey).toMatch(/^whsec_/);

      const list = await api.get("/api/webhooks");
      expect(list.json.total).toBe(1);
      expect(list.json.data[0].signingKeyHint).toBe(
        created.json.signingKeyHint,
      );

      expect(JSON.stringify(list.json)).not.toContain(created.json.signingKey);
      expect(list.json.data[0]).not.toHaveProperty("signingKey");
    });

    it("lets an app delete its webhook, softly", async () => {
      const created = await api.post("/api/webhooks", body);

      const deleted = await api.delete(`/api/webhooks/${created.json.id}`);
      expect(deleted.status).toBe(200);
      expect(deleted.json).not.toHaveProperty("signingKey");

      expect((await api.get("/api/webhooks")).json.total).toBe(0);
      expect(
        (await api.delete(`/api/webhooks/${created.json.id}`)).status,
      ).toBe(404);
    });

    it("lists delivery attempts and keeps them private to the app", async () => {
      const created = await api.post("/api/webhooks", body);
      const otherKey = await createApiKey((await createApp()).id, {
        scopes: [
          ApiKeyScope.WebhookRead,
          ApiKeyScope.WebhookWrite,
          ApiKeyScope.WebhookDelete,
        ],
      });

      expect(
        (await api.get(`/api/webhooks/${created.json.id}/deliveries`)).json
          .total,
      ).toBe(0);
      expect(
        (
          await client(otherKey.credentials).get(
            `/api/webhooks/${created.json.id}/deliveries`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await client(otherKey.credentials).delete(
            `/api/webhooks/${created.json.id}`,
          )
        ).status,
      ).toBe(404);
    });

    it.each([
      ["a non-http url", { url: "ftp://example.com/x" }],
      ["no categories", { categories: [] }],
      ["an unknown category", { categories: ["Everything"] }],
      ["too many retries", { maxRetries: 500 }],
    ])("rejects %s", async (_label, overrides) => {
      const res = await api.post("/api/webhooks", { ...body, ...overrides });

      expect(res.status).toBe(422);
    });

    it("rejects the same url twice", async () => {
      await api.post("/api/webhooks", body);

      expect((await api.post("/api/webhooks", body)).status).toBe(409);
    });
  });

  it("returns the operator as the refund address default nowhere in app responses", async () => {
    const res = await api.get("/api/chains");

    expect(JSON.stringify(res.json)).not.toContain(operatorAddress);
  });
});
