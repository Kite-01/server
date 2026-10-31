import {
  address,
  createChain,
  createConfiguredChain,
} from "../../test/factories";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, SdkRequestError } from "../../shared/errors";
import { nearIntentsMock, resetMocks } from "../../test/mocks";
import { ChainService } from "../Chain.service";
import { AppService } from "../App.service";
import { Provider } from "../../shared/constants";

const service = new AppService();

describe("AppService", () => {
  beforeEach(() => {
    resetMocks();
  });

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

  describe("chains", () => {
    let appId: string;
    let chainId: string;

    beforeEach(async () => {
      appId = (await service.createApp({ name: "Shop" })).id;
      chainId = (await createConfiguredChain()).chain.id;
    });

    it("takes payments on a chain once it has an address there", async () => {
      expect(await service.getChains(appId)).toEqual([]);

      const row = await service.setChain(
        appId,
        chainId,
        address(0x5e77).toLowerCase(),
      );

      expect(row).toMatchObject({ chainId, address: address(0x5e77) });
      expect(await service.getChainAddress(appId, chainId)).toBe(
        address(0x5e77),
      );
      expect([...(await service.getChainIds(appId))]).toEqual([chainId]);
    });

    it("changes the address, and stops taking payments when turned off", async () => {
      await service.setChain(appId, chainId, address(0x5e77));
      await service.setChain(appId, chainId, address(0x5e78));
      expect(await service.getChainAddress(appId, chainId)).toBe(
        address(0x5e78),
      );

      expect(await service.removeChain(appId, chainId)).toMatchObject({
        chainId,
      });
      expect(await service.getChainAddress(appId, chainId)).toBeNull();
      expect(await service.removeChain(appId, chainId)).toBeUndefined();
    });

    it("needs a valid address and a configured chain", async () => {
      await expect(service.setChain(appId, chainId, "0x123")).rejects.toThrow(
        "The address is not a valid address",
      );

      const bare = await createChain("eip155:10");
      await expect(
        service.setChain(appId, bare.id, address(0x5e77)),
      ).rejects.toThrow("This chain is not configured yet");
      await expect(
        service.setChain(appId, crypto.randomUUID(), address(0x5e77)),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("leaves out chains that were removed", async () => {
      await service.setChain(appId, chainId, address(0x5e77));
      await new ChainService().deleteChain(chainId);

      expect(await service.getChains(appId)).toEqual([]);
    });
  });

  describe("payout destination", () => {
    const NEAR_USDC = "nep141:usdc.near";

    beforeEach(() => {
      nearIntentsMock.getTokens.mockResolvedValue([
        { assetId: NEAR_USDC, blockchain: "near", symbol: "USDC", decimals: 6 },
      ]);
      nearIntentsMock.quote.mockResolvedValue({ quote: {} });
    });

    it("checks the destination with a trial quote that moves nothing", async () => {
      const created = await service.createApp({
        name: "Shop",
        payoutAsset: NEAR_USDC,
        payoutAddress: "shop.near",
      });

      expect(created).toMatchObject({
        payoutAsset: NEAR_USDC,
        payoutAddress: "shop.near",
      });
      expect(nearIntentsMock.quote).toHaveBeenCalledWith(
        expect.objectContaining({
          dry: true,
          destinationAsset: NEAR_USDC,
          recipient: "shop.near",
          recipientType: "DESTINATION_CHAIN",
        }),
        expect.anything(),
      );
    });

    it("needs both the token and the address, and keeps them on other changes", async () => {
      const created = await service.createApp({ name: "Shop" });

      await expect(
        service.updateApp(created.id, { payoutAsset: NEAR_USDC }),
      ).rejects.toThrow(
        "Set both the payout token and the payout address, or neither",
      );

      await service.updateApp(created.id, {
        payoutAsset: NEAR_USDC,
        payoutAddress: "shop.near",
      });
      const renamed = await service.updateApp(created.id, { name: "Renamed" });
      expect(renamed).toMatchObject({
        payoutAsset: NEAR_USDC,
        payoutAddress: "shop.near",
      });

      nearIntentsMock.quote.mockClear();
      const cleared = await service.updateApp(created.id, {
        payoutAsset: null,
        payoutAddress: null,
      });
      expect(cleared).toMatchObject({ payoutAsset: null, payoutAddress: null });
      expect(nearIntentsMock.quote).not.toHaveBeenCalled();
    });

    it("refuses a token NEAR Intents doesn't list, or an address it rejects", async () => {
      await expect(
        service.createApp({
          name: "Shop",
          payoutAsset: "nep141:nope.near",
          payoutAddress: "shop.near",
        }),
      ).rejects.toThrow("NEAR Intents doesn't support this payout token");

      nearIntentsMock.quote.mockRejectedValue(
        new SdkRequestError(
          Provider.NearIntents,
          "/quote",
          { isOk: false, statusCode: 400, data: {} },
          "recipient is not valid",
        ),
      );
      await expect(
        service.createApp({
          name: "Shop",
          payoutAsset: NEAR_USDC,
          payoutAddress: "not an account",
        }),
      ).rejects.toThrow(
        "NEAR Intents rejected the payout destination: recipient is not valid",
      );
    });
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
