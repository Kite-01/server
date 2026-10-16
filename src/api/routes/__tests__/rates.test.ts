import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfiguredChain, address } from "../../../test/factories";
import { client, rootCredentials } from "../../../test/api";
import { fakeActor, resetMocks } from "../../../test/mocks";
import { priceFeed } from "../../../db/schema";
import { db } from "../../../db";

const api = client(rootCredentials());

describe("GET /api/rate", () => {
  beforeEach(async () => {
    resetMocks();
    const { chain } = await createConfiguredChain();
    await db.insert(priceFeed).values({
      chainId: chain.id,
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      address: address(0xe0),
      decimals: 8,
    });

    const now = BigInt(Math.floor(Date.now() / 1000));

    fakeActor.publicClient.mockResolvedValue({
      readContract: vi
        .fn()
        .mockResolvedValue([10n, 10_800_000_000n, 0n, now - 60n, 10n]),
    });
  });

  it("converts a decimal amount using the live USD price feed", async () => {
    const response = await api.get("/api/rate", {
      currency: "eur",
      amount: "1.25",
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      from: { currency: "EUR", amount: "1.25" },
      to: { currency: "USD", amount: "135" },
    });
  });

  it("returns USD amounts unchanged", async () => {
    const response = await api.get("/api/rate", {
      currency: "usd",
      amount: "7.50",
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      from: { currency: "USD", amount: "7.50" },
      to: { currency: "USD", amount: "7.5" },
    });
  });

  it("rejects unsupported currencies", async () => {
    const response = await api.get("/api/rate", {
      currency: "GBP",
      amount: "1",
    });

    expect(response.status).toBe(422);
    expect(response.json.error.message).toBe("GBP is not a supported currency");
  });

  it("rejects amounts with more than 18 fractional digits", async () => {
    const response = await api.get("/api/rate", {
      currency: "EUR",
      amount: "1.1234567890123456789",
    });

    expect(response.status).toBe(422);
  });
});
