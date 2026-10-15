import {
  address,
  createApp,
  createConfiguredChain,
  createPaymentLink,
  createToken,
  USDC,
} from "../../../test/factories";
import { createQuoteRow, createTransferRow } from "../../../test/transfers";
import { beforeEach, describe, expect, it } from "vitest";
import { rootCredentials, call, client } from "../../../test/api";
import { app as appTable, priceFeed } from "../../../db/schema";
import { resetMocks } from "../../../test/mocks";
import { eq } from "drizzle-orm";
import { db } from "../../../db";

const get = (path: string) => call("GET", path, {});
const post = (path: string, body: unknown) => {
  return call("POST", path, { "content-type": "application/json" }, { body });
};

describe("checkout", () => {
  let appId: string;
  let chain: Awaited<ReturnType<typeof createConfiguredChain>>;
  let link: Awaited<ReturnType<typeof createPaymentLink>>;
  let otherLink: Awaited<ReturnType<typeof createPaymentLink>>;

  beforeEach(async () => {
    resetMocks();
    appId = (await createApp({ name: "Shop" })).id;
    chain = await createConfiguredChain();
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
      await createToken(chain.chain.id, { symbol: "WETH" });

      const res = await get(`/api/checkout/${link.id}`);

      expect(res.status).toBe(200);
      expect(res.json.paymentLink).toMatchObject({
        id: link.id,
        title: "Pro plan",
        currency: "USD",
      });

      expect(res.json.paymentLink.appId).toBeUndefined();
      expect(res.json.app).toMatchObject({ name: "Shop" });
      expect(res.json.chains).toHaveLength(1);
      expect(res.json.chains[0]).toMatchObject({
        id: chain.chain.id,
        caip2Id: "eip155:8453",
        chainId: 8453,
      });

      const tokens = Object.fromEntries(
        res.json.chains[0].tokens.map(
          (t: { symbol: string; x402: boolean }) => [t.symbol, t.x402],
        ),
      );

      expect(tokens).toEqual({ USDC: true, WETH: false });
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

    it("only takes registered tokens", async () => {
      const res = await post(`/api/checkout/${link.id}/quote`, {
        chainId: chain.chain.id,
        sourceTokenAddress: address(0xdead),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("quotes and transfers of another link", () => {
    it("can't be paid through this link", async () => {
      const quote = await quoteFor(otherLink.id);

      const transfer = await post(`/api/checkout/${link.id}/transfer`, {
        quoteId: quote.id,
        refundAddress: address(0x7e7),
      });
      const x402 = await post(`/api/checkout/${link.id}/x402`, {
        quoteId: quote.id,
      });

      expect(transfer.status).toBe(404);
      expect(x402.status).toBe(404);
      // Refused for the quote, not because the route doesn't exist.
      for (const res of [transfer, x402]) {
        expect(res.json.error.message).not.toBe("Route not found");
      }
    });

    it("can't be tracked or settled through this link", async () => {
      const row = await createTransferRow({
        appId,
        quote: await quoteFor(otherLink.id),
      });

      const tracked = await get(`/api/checkout/${link.id}/transfer/${row.id}`);
      const settled = await post(`/api/checkout/${link.id}/x402/settle`, {
        paymentPayload: {},
        paymentRequirements: {
          scheme: "exact",
          network: "eip155:8453",
          asset: USDC,
          amount: "1000000",
          payTo: row.payinAddress,
          maxTimeoutSeconds: 60,
          extra: {},
        },
      });

      expect(tracked.status).toBe(404);
      expect(settled.status).toBe(404);
      for (const res of [tracked, settled]) {
        expect(res.json.error.message).not.toBe("Route not found");
      }
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
