import { describe, expect, it } from "vitest";
import { AppService } from "../App.service";
import { address } from "../../test/factories";

const service = new AppService();

describe("AppService", () => {
  it("creates and reads an app", async () => {
    const created = await service.createApp({
      name: "Test app",
      websiteUrl: "https://test.app",
    });

    expect(await service.getApp(created.id)).toMatchObject({
      name: "Test app",
      websiteUrl: "https://test.app",
      deletedAt: null,
    });
  });

  it("updates only the given fields", async () => {
    const created = await service.createApp({
      name: "Test app",
      websiteUrl: "https://test.app",
    });

    const updated = await service.updateApp(created.id, {
      name: "Test app (updated)",
    });

    expect(updated).toMatchObject({
      name: "Test app (updated)",
      websiteUrl: "https://test.app",
    });

    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );
  });

  it("stores the settlement address checksummed, and clears it with null", async () => {
    const created = await service.createApp({
      name: "Shop",
      settlementAddress: address(0x5e77).toLowerCase(),
    });
    expect(created.settlementAddress).toBe(address(0x5e77));
    expect(await service.getSettlementAddress(created.id)).toBe(
      address(0x5e77),
    );

    const moved = await service.updateApp(created.id, {
      settlementAddress: address(0x5e78).toLowerCase(),
    });
    expect(moved?.settlementAddress).toBe(address(0x5e78));

    const cleared = await service.updateApp(created.id, {
      settlementAddress: null,
    });
    expect(cleared?.settlementAddress).toBeNull();
    expect(await service.getSettlementAddress(created.id)).toBeNull();
  });

  it("keeps the settlement address when other fields change", async () => {
    const created = await service.createApp({
      name: "Shop",
      settlementAddress: address(0x5e77),
    });

    const updated = await service.updateApp(created.id, { name: "Renamed" });
    expect(updated?.settlementAddress).toBe(address(0x5e77));
  });

  it("rejects a malformed settlement address", async () => {
    await expect(
      service.createApp({ name: "Shop", settlementAddress: "0x123" }),
    ).rejects.toThrow("The settlement address is not a valid address");

    const created = await service.createApp({ name: "Shop" });
    await expect(
      service.updateApp(created.id, { settlementAddress: "" }),
    ).rejects.toThrow("The settlement address is not a valid address");
  });

  it("soft deletes once and hides the app everywhere", async () => {
    const created = await service.createApp({ name: "Gone" });

    expect((await service.deleteApp(created.id))?.deletedAt).toBeInstanceOf(
      Date,
    );
    expect(await service.deleteApp(created.id)).toBeUndefined();
    expect(await service.getApp(created.id)).toBeUndefined();
    expect(
      await service.updateApp(created.id, { name: "Back" }),
    ).toBeUndefined();
    expect((await service.getApps({})).total).toBe(0);
  });

  it("lists newest first with search and paging", async () => {
    await service.createApp({ name: "Alpha shop" });
    await service.createApp({ name: "Beta shop" });
    await service.createApp({ name: "Gamma store" });

    const all = await service.getApps({});
    expect(all.data.map((a) => a.name)).toEqual([
      "Gamma store",
      "Beta shop",
      "Alpha shop",
    ]);

    const shops = await service.getApps({ q: "shop" });
    expect(shops.total).toBe(2);

    const page = await service.getApps({ page: 2, pageSize: 2 });
    expect(page.data.map((a) => a.name)).toEqual(["Alpha shop"]);
  });

  it("treats LIKE wildcards in search as literals", async () => {
    await service.createApp({ name: "100% pure" });
    await service.createApp({ name: "plain" });

    expect((await service.getApps({ q: "%" })).data.map((a) => a.name)).toEqual(
      ["100% pure"],
    );
    expect((await service.getApps({ q: "_" })).total).toBe(0);
  });
});
