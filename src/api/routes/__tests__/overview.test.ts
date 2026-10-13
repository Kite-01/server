import {
  createApp,
  createChain,
  createCustomer,
} from "../../../test/factories";
import { client, rootCredentials } from "../../../test/api";
import { describe, expect, it } from "vitest";
import { eventFor } from "../../../test/events";

describe("overview", () => {
  const root = client(rootCredentials());

  it("returns the service version and the configured chains", async () => {
    const chain = await createChain();
    const res = await root.get("/api/overview/info");

    expect(res.status).toBe(200);
    expect(res.json.version).toEqual(expect.any(String));
    expect(res.json.chains).toEqual([
      expect.objectContaining({ id: chain.id, isConfigured: false }),
    ]);
  });

  it("returns stats for a date range", async () => {
    await createCustomer((await createApp()).id);

    const res = await root.get("/api/overview/stats", {
      from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 60 * 1000).toISOString(),
    });

    expect(res.status).toBe(200);
    expect(res.json.customers.total).toBe(1);
    expect(res.json.amountProcessed).toMatchObject({ amount: "0", count: 0 });
    expect(res.json.series.length).toBeGreaterThan(0);
  });

  it("lists recent events", async () => {
    const event = await eventFor((await createApp()).id);
    const res = await root.get("/api/overview/events");

    expect(res.status).toBe(200);
    expect(res.json.total).toBe(1);
    expect(res.json.data[0].id).toBe(event.id);
  });
});
