import { describe, expect, it } from "vitest";
import { AppService } from "../App.service";

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
