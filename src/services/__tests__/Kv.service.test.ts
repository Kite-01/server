import { describe, expect, it } from "vitest";
import { KeyType, KeyVars } from "../../shared/constants";
import { KvService } from "../Kv.service";
import { eq } from "drizzle-orm";
import { kv } from "../../db/schema";
import { db } from "../../db";

const service = new KvService();

const rawValue = async (key: KeyVars) => {
  const [row] = await db.select().from(kv).where(eq(kv.key, key));
  return row?.value;
};

describe("KvService", () => {
  it("encrypts secure strings at rest and decrypts on read", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyApiKey,
      type: KeyType.SecureString,
      value: "alchemy-secret",
    });

    const stored = await rawValue(KeyVars.AlchemyApiKey);
    expect(stored).toMatch(/^cipher\./);
    expect(stored).not.toContain("alchemy-secret");
    expect((await service.getKv(KeyVars.AlchemyApiKey))?.value).toBe(
      "alchemy-secret",
    );
  });

  it("stores plain strings as they are", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyGasPolicyId,
      type: KeyType.String,
      value: "policy-1",
    });

    expect(await rawValue(KeyVars.AlchemyGasPolicyId)).toBe("policy-1");
  });

  it("overwrites on upsert and re-encrypts", async () => {
    const input = {
      key: KeyVars.QuickNodeApiKey,
      type: KeyType.SecureString,
    } as const;

    await service.upsertKv({ ...input, value: "one" });
    const first = await rawValue(KeyVars.QuickNodeApiKey);
    await service.upsertKv({ ...input, value: "two" });

    expect(await rawValue(KeyVars.QuickNodeApiKey)).not.toBe(first);
    expect((await service.getKv(KeyVars.QuickNodeApiKey))?.value).toBe("two");
  });

  it("binds a ciphertext to its key", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyApiKey,
      type: KeyType.SecureString,
      value: "alchemy-secret",
    });
    const stored = await rawValue(KeyVars.AlchemyApiKey);

    await db.insert(kv).values({
      key: KeyVars.QuickNodeApiKey,
      type: KeyType.SecureString,
      value: stored,
    });

    await expect(service.getKv(KeyVars.QuickNodeApiKey)).rejects.toThrow();
  });

  it("builds sdk variables from every stored value", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyApiKey,
      type: KeyType.SecureString,
      value: "secret",
    });
    await service.upsertKv({
      key: KeyVars.AlchemyGasPolicyId,
      type: KeyType.String,
      value: "policy",
    });

    expect(await service.getSdkOptionVariables()).toEqual({
      [KeyVars.AlchemyApiKey]: "secret",
      [KeyVars.AlchemyGasPolicyId]: "policy",
    });
  });

  it("filters by key and returns nothing for an empty key list", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyGasPolicyId,
      type: KeyType.String,
      value: "policy",
    });

    expect(await service.getKvs([])).toEqual([]);
    expect(
      (await service.getKvs([KeyVars.AlchemyGasPolicyId])).map((r) => r.key),
    ).toEqual([KeyVars.AlchemyGasPolicyId]);
  });

  it("keeps the first value when two callers create the same key", async () => {
    const input = {
      key: KeyVars.QuickNodeWebhookSecurityToken,
      type: KeyType.SecureString,
    } as const;

    const [a, b] = await Promise.all([
      service.getOrCreateKv({ ...input, value: "first" }),
      service.getOrCreateKv({ ...input, value: "second" }),
    ]);

    expect(a).toBe(b);
    expect((await service.getKv(input.key))?.value).toBe(a);
    expect(await service.getOrCreateKv({ ...input, value: "third" })).toBe(a);
  });

  it("deletes a key", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyGasPolicyId,
      type: KeyType.String,
      value: "policy",
    });
    await service.deleteKv(KeyVars.AlchemyGasPolicyId);

    expect(await service.getKv(KeyVars.AlchemyGasPolicyId)).toBeNull();
  });
});
