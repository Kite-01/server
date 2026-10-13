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
} from "../../../shared/constants";
import { fakeActor, operatorAddress, resetMocks } from "../../../test/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { client, publicCall, rootCredentials } from "../../../test/api";
import { createQuoteRow, payinFor } from "../../../test/transfers";
import { ChainService } from "../../../services/Chain.service";
import { common } from "../../../shared/common";
import { kite } from "../../../shared/kiteContract";

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

    it("is readable with only a key id and public key", async () => {
      const res = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        "/api/chains",
      );

      expect(res.status).toBe(200);
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

    it("lists tokens and finds one by address with the public key", async () => {
      await createToken(chainId, {
        address: WETH,
        symbol: "WETH",
      });

      const list = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        "/api/tokens",
        { query: { chainId, q: "weth" } },
      );

      expect(list.json.total).toBe(1);

      const one = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        `/api/tokens/${chainId}/${WETH.toLowerCase()}`,
      );

      expect(one.status).toBe(200);
      expect(one.json).toMatchObject({
        address: WETH,
        symbol: "WETH",
      });
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

    it("shows the whole customer, traits included, to a key id and public key", async () => {
      const customer = await createCustomer(appId, {
        traits: { tier: "gold" },
      });

      const res = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        `/api/customers/${customer.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        id: customer.id,
        traits: { tier: "gold" },
      });
    });

    it("does not list or delete customers for a key id and public key", async () => {
      const customer = await createCustomer(appId);
      const res1 = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        "/api/customers",
      );

      expect(res1.status).toBe(401);

      const res2 = await publicCall(
        key.row.id,
        key.publicKey,
        "DELETE",
        `/api/customers/${customer.id}`,
      );

      expect(res2.status).toBe(401);
    });

    it("keeps customers inside their app", async () => {
      const app = await createApp();
      const foreign = await createCustomer(app.id);

      const res1 = await api.get(`/api/customers/${foreign.id}`);
      const res2 = await api.delete(`/api/customers/${foreign.id}`);
      const res3 = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        `/api/customers/${foreign.id}`,
      );

      expect(res1.status).toBe(404);
      expect(res2.status).toBe(404);
      expect(res3.status).toBe(404);
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

    it("lets a checkout page read a link and quote it with only the public key", async () => {
      const link = await createPaymentLink(appId, { amount: "10" });
      const read = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        `/api/payment-links/${link.id}`,
      );

      expect(read.json.id).toBe(link.id);

      const quoted = await publicCall(
        key.row.id,
        key.publicKey,
        "POST",
        `/api/payment-links/${link.id}/pay`,
        {
          body: {
            chainId,
            sourceTokenAddress: USDC,
          },
        },
      );

      expect(quoted.status).toBe(201);
      expect(quoted.json).toMatchObject({
        paymentLinkId: link.id,
        sourceAmount: "10000000",
        targetAmount: "10000000",
      });

      const fetched = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        `/api/quotes/${quoted.json.id}`,
      );

      expect(fetched.json.sourceToken.symbol).toBe("USDC");
    });

    it("needs a signature to create an arbitrary quote", async () => {
      const res = await publicCall(
        key.row.id,
        key.publicKey,
        "POST",
        "/api/quotes",
        {
          body: {
            chainId,
            sourceTokenAddress: USDC,
            amount: "1000000",
          },
        },
      );

      expect(res.status).toBe(401);
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

    it("lets a payment-link checkout open and follow a transfer with only the public key", async () => {
      const link = await createPaymentLink(appId);
      const quote = await quoteVia(link.id);
      const created = await publicCall(
        key.row.id,
        key.publicKey,
        "POST",
        "/api/transfers",
        {
          body: {
            quoteId: quote.id,
            refundAddress: REFUND_TO,
          },
        },
      );

      expect(created.status).toBe(201);

      const read = await publicCall(
        key.row.id,
        key.publicKey,
        "GET",
        `/api/transfers/${created.json.id}`,
      );

      expect(read.status).toBe(200);
    });

    it("does not let the public key open a transfer for a quote that is not from a payment link", async () => {
      const quote = await quoteVia();
      const res = await publicCall(
        key.row.id,
        key.publicKey,
        "POST",
        "/api/transfers",
        {
          body: {
            quoteId: quote.id,
            refundAddress: REFUND_TO,
          },
        },
      );

      expect(res.status).toBe(401);
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
