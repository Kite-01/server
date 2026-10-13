import { beforeEach, describe, expect, it } from "vitest";
import { ApiKeyScope } from "../../shared/constants";
import { signing } from "../../shared/signing";
import { createApp } from "../../test/factories";
import { ApiKeyService } from "../ApiKey.service";
import { apiKey, apiNonce } from "../../db/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const service = new ApiKeyService();

const newKey = (
  appId: string,
  values: Partial<typeof apiKey.$inferInsert> = {},
) =>
  service.createApiKey({
    appId,
    label: "server",
    publicKey: signing.generateKeyPair().publicKey,
    scopes: [ApiKeyScope.QuotesRead],
    ...values,
  });

describe("ApiKeyService", () => {
  let appId: string;
  let otherAppId: string;

  beforeEach(async () => {
    appId = (await createApp()).id;
    otherAppId = (await createApp()).id;
  });

  it("creates a key that only stores the public key", async () => {
    const key = await newKey(appId, {
      scopes: [ApiKeyScope.QuotesRead, ApiKeyScope.TransfersWrite],
      allowedOrigins: ["https://shop.example"],
    });

    expect(key.appId).toBe(appId);
    expect(key.scopes).toEqual([
      ApiKeyScope.QuotesRead,
      ApiKeyScope.TransfersWrite,
    ]);
    expect(key.revokedAt).toBeNull();
    expect(Object.keys(key)).not.toContain("privateKey");
  });

  it("rejects scopes outside the enum", async () => {
    await expect(
      newKey(appId, { scopes: ["admin" as ApiKeyScope] }),
    ).rejects.toThrow();
  });

  it("scopes reads and writes to the owning app", async () => {
    const key = await newKey(appId);

    expect(await service.getApiKey(appId, key.id)).toMatchObject({
      id: key.id,
    });
    expect(await service.getApiKey(otherAppId, key.id)).toBeUndefined();
    expect(
      await service.updateApiKey(otherAppId, key.id, { label: "stolen" }),
    ).toBeUndefined();
    expect(await service.revokeApiKey(otherAppId, key.id)).toBeUndefined();
    expect(await service.deleteApiKey(otherAppId, key.id)).toBeUndefined();
    expect(await service.getApiKey(appId, key.id)).toMatchObject({
      label: "server",
      revokedAt: null,
    });
  });

  it("updates the label", async () => {
    const key = await newKey(appId);
    const updated = await service.updateApiKey(appId, key.id, {
      label: "renamed",
    });

    expect(updated?.label).toBe("renamed");
  });

  it("revokes once and keeps the first revocation time", async () => {
    const key = await newKey(appId);
    const first = await service.revokeApiKey(appId, key.id);
    const second = await service.revokeApiKey(appId, key.id);

    expect(first?.revokedAt).toBeInstanceOf(Date);
    expect(second?.revokedAt?.getTime()).toBe(first?.revokedAt?.getTime());
  });

  it("deletes a key and reports what was deleted", async () => {
    const key = await newKey(appId);

    expect((await service.deleteApiKey(appId, key.id))?.id).toBe(key.id);
    expect(await service.getApiKey(appId, key.id)).toBeUndefined();
    expect(await service.deleteApiKey(appId, key.id)).toBeUndefined();
  });

  it("records last use only for usable keys and at most once a minute", async () => {
    const live = await newKey(appId);
    const revoked = await newKey(appId);
    const expired = await newKey(appId, {
      expiresAt: new Date(Date.now() - 1000),
    });
    await service.revokeApiKey(appId, revoked.id);

    await service.updateApiKeyLastUsed(appId, live.id);
    await service.updateApiKeyLastUsed(appId, revoked.id);
    await service.updateApiKeyLastUsed(appId, expired.id);

    const first = (await service.getApiKey(appId, live.id))!.lastUsedAt!;
    expect(first).toBeInstanceOf(Date);
    expect((await service.getApiKey(appId, revoked.id))!.lastUsedAt).toBeNull();
    expect((await service.getApiKey(appId, expired.id))!.lastUsedAt).toBeNull();

    await service.updateApiKeyLastUsed(appId, live.id);
    expect((await service.getApiKey(appId, live.id))!.lastUsedAt).toEqual(
      first,
    );
  });

  it("loads a key together with its app for authentication", async () => {
    const key = await newKey(appId);
    const found = await service.getApiKeyWithApp(key.id);

    expect(found?.app.id).toBe(appId);
    expect(await service.getApiKeyWithApp(crypto.randomUUID())).toBeUndefined();
  });

  it("lists keys newest first, per app or across apps", async () => {
    const a = await newKey(appId, { label: "a" });
    const b = await newKey(appId, { label: "b" });
    const c = await newKey(otherAppId, { label: "c" });

    const own = await service.getApiKeys({ appId });
    expect(own.data.map((k) => k.id)).toEqual([b.id, a.id]);
    expect(own.total).toBe(2);

    const all = await service.getApiKeys({});
    expect(all.data.map((k) => k.id)).toEqual([c.id, b.id, a.id]);
  });

  it("paginates", async () => {
    for (let i = 0; i < 5; i++) await newKey(appId, { label: `k${i}` });

    const page = await service.getApiKeys({ appId, page: 2, pageSize: 2 });
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(page.data.map((k) => k.label)).toEqual(["k2", "k1"]);
  });

  it("accepts a nonce once per key", async () => {
    const key = await newKey(appId);

    expect(await service.consumeNonce(key.id, "nonce-aaaaaaaa")).toBe(true);
    expect(await service.consumeNonce(key.id, "nonce-aaaaaaaa")).toBe(false);
    expect(await service.consumeNonce(otherAppId, "nonce-aaaaaaaa")).toBe(true);
  });

  it("prunes old nonces only", async () => {
    await service.consumeNonce("root", "nonce-old-0001");
    await db
      .update(apiNonce)
      .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(apiNonce.nonce, "nonce-old-0001"));
    await service.consumeNonce("root", "nonce-new-0001");

    await service.pruneNonces(new Date(Date.now() - 10 * 60 * 1000));

    expect(await service.consumeNonce("root", "nonce-old-0001")).toBe(true);
    expect(await service.consumeNonce("root", "nonce-new-0001")).toBe(false);
  });
});
