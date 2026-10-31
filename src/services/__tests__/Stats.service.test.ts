import {
  createApp,
  createConfiguredChain,
  createCustomer,
  createToken,
  WETH,
} from "../../test/factories";
import { createQuoteRow, createTransferRow } from "../../test/transfers";
import { beforeEach, describe, expect, it } from "vitest";
import { TransferStatus } from "../../shared/constants";
import { StatsService } from "../Stats.service";
import { customer } from "../../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const service = new StatsService();

const at = (iso: string) => new Date(iso);
const range = {
  from: at("2026-10-01T00:00:00Z"),
  to: at("2026-10-08T00:00:00Z"),
};

describe("StatsService", () => {
  let appId: string;
  let otherAppId: string;
  let chainId: string;
  let usdcId: string;
  let wethId: string;

  beforeEach(async () => {
    appId = (await createApp()).id;
    otherAppId = (await createApp()).id;
    const configured = await createConfiguredChain();
    chainId = configured.chain.id;
    usdcId = configured.usdc.id;
    wethId = (
      await createToken(chainId, {
        address: WETH,
        symbol: "WETH",
      })
    ).id;
  });

  const settle = async (input: {
    createdAt: string;
    usd: string;
    app?: string;
    status?: TransferStatus;
    token?: string;
  }) => {
    const owner = input.app ?? appId;
    const quote = await createQuoteRow({
      appId: owner,
      chainId,
      sourceTokenId: input.token ?? usdcId,
      targetTokenId: usdcId,
      targetUsdAmount: input.usd,
    });

    return createTransferRow({
      appId: owner,
      quote,
      status: input.status ?? TransferStatus.Settled,
      createdAt: at(input.createdAt),
    });
  };

  it("sums settled transfers created inside the range", async () => {
    await settle({ createdAt: "2026-10-02T10:00:00Z", usd: "100" });
    await settle({ createdAt: "2026-10-05T10:00:00Z", usd: "50.5" });
    await settle({
      createdAt: "2026-10-03T10:00:00Z",
      usd: "999",
      status: TransferStatus.Failed,
    });
    await settle({ createdAt: "2026-09-30T23:59:59Z", usd: "7" });
    await settle({ createdAt: "2026-10-08T00:00:00Z", usd: "7" });

    const stats = await service.getStats(range);

    expect(stats.amountProcessed).toMatchObject({ count: 2 });
    expect(Number(stats.amountProcessed.amount)).toBe(150.5);
  });

  it("compares with the period of the same length before", async () => {
    await settle({ createdAt: "2026-09-26T10:00:00Z", usd: "100" });
    await settle({ createdAt: "2026-10-02T10:00:00Z", usd: "150" });

    const stats = await service.getStats(range);

    expect(stats.amountProcessed.change).toBe(50);
  });

  it("has no change figure when the previous period was empty", async () => {
    await settle({ createdAt: "2026-10-02T10:00:00Z", usd: "10" });

    expect((await service.getStats(range)).amountProcessed.change).toBeNull();
  });

  it("fills empty days in the series", async () => {
    await settle({ createdAt: "2026-10-02T10:00:00Z", usd: "10" });
    await settle({ createdAt: "2026-10-02T18:00:00Z", usd: "5" });
    await settle({ createdAt: "2026-10-04T10:00:00Z", usd: "1" });

    const { series } = await service.getStats(range);

    expect(series).toHaveLength(7);
    expect(series.map((p) => p.bucket.slice(0, 10))).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(series.map((p) => Number(p.amount))).toEqual([0, 15, 0, 1, 0, 0, 0]);
    expect(series.map((p) => p.count)).toEqual([0, 2, 0, 1, 0, 0, 0]);
  });

  it("uses hourly buckets for ranges up to two days", async () => {
    await settle({ createdAt: "2026-10-02T10:30:00Z", usd: "10" });

    const { series } = await service.getStats({
      from: at("2026-10-02T00:00:00Z"),
      to: at("2026-10-03T00:00:00Z"),
    });

    expect(series).toHaveLength(24);
    expect(series[10]).toMatchObject({
      bucket: "2026-10-02T10:00:00",
      count: 1,
    });
  });

  it("buckets by the caller's time zone", async () => {
    await settle({ createdAt: "2026-10-03T23:30:00Z", usd: "10" });

    const utc = await service.getStats(range);
    const lagos = await service.getStats({
      ...range,
      timeZone: "Africa/Lagos",
    });

    expect(utc.series.find((p) => p.count === 1)?.bucket.slice(0, 10)).toBe(
      "2026-10-03",
    );
    expect(lagos.series.find((p) => p.count === 1)?.bucket.slice(0, 10)).toBe(
      "2026-10-04",
    );
  });

  it("ranks top tokens by value or by volume", async () => {
    await settle({
      createdAt: "2026-10-02T10:00:00Z",
      usd: "1000",
      token: wethId,
    });
    for (let i = 0; i < 3; i++) {
      await settle({
        createdAt: "2026-10-02T11:00:00Z",
        usd: "10",
        token: usdcId,
      });
    }

    const byValue = await service.getStats({ ...range, rank: "value" });
    const byVolume = await service.getStats({ ...range, rank: "volume" });

    expect(byValue.topTokens.map((t) => t.symbol)).toEqual(["WETH", "USDC"]);
    expect(byVolume.topTokens.map((t) => t.symbol)).toEqual(["USDC", "WETH"]);
    expect(byVolume.topTokens[0]).toMatchObject({
      volume: 3,
      value: "30.000000000000000000",
      chainName: "Base",
      chainIcon: expect.stringContaining("/blockchains/base/info/logo.png"),
    });
  });

  it("can be limited to one app", async () => {
    await settle({ createdAt: "2026-10-02T10:00:00Z", usd: "10" });
    await settle({
      createdAt: "2026-10-02T10:00:00Z",
      usd: "90",
      app: otherAppId,
    });
    await createCustomer(appId);
    await createCustomer(otherAppId);
    await createCustomer(otherAppId);
    await db.update(customer).set({ createdAt: at("2026-10-02T00:00:00Z") });

    const mine = await service.getStats({ ...range, appId });
    const all = await service.getStats(range);

    expect(Number(mine.amountProcessed.amount)).toBe(10);
    expect(mine.customers.total).toBe(1);
    expect(Number(all.amountProcessed.amount)).toBe(100);
    expect(all.customers.total).toBe(3);
  });

  it("reports customer growth over the range", async () => {
    const early = await createCustomer(appId);
    await db
      .update(customer)
      .set({ createdAt: at("2026-09-01T00:00:00Z") })
      .where(eq(customer.id, early.id));
    const late = await createCustomer(appId);
    await db
      .update(customer)
      .set({ createdAt: at("2026-10-03T00:00:00Z") })
      .where(eq(customer.id, late.id));

    const { customers } = await service.getStats(range);

    expect(customers).toEqual({ total: 2, change: 100 });
  });

  it.each([
    ["an inverted range", { from: range.to, to: range.from }],
    [
      "a range over 400 days",
      { from: at("2024-01-01T00:00:00Z"), to: at("2026-01-01T00:00:00Z") },
    ],
    ["an unknown time zone", { ...range, timeZone: "Mars/Olympus" }],
  ])("rejects %s", async (_label, input) => {
    await expect(service.getStats(input)).rejects.toThrow();
  });
});
