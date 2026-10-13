import { beforeEach, describe, expect, it } from "vitest";
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

  it("never exposes secure values in the overview", async () => {
    await service.upsertKv({
      key: KeyVars.AlchemyApiKey,
      type: KeyType.SecureString,
      value: "alchemy-secret",
    });
    await service.upsertKv({
      key: KeyVars.AlchemyGasPolicyId,
      type: KeyType.String,
      value: "policy-1",
    });

    const overview = await service.getOverview();
    const byKey = Object.fromEntries(overview.map((row) => [row.key, row]));

    expect(overview).toHaveLength(Object.values(KeyVars).length);
    expect(byKey[KeyVars.AlchemyApiKey]).toMatchObject({
      isSet: true,
      value: null,
      type: KeyType.SecureString,
    });
    expect(byKey[KeyVars.AlchemyGasPolicyId]).toMatchObject({
      isSet: true,
      value: "policy-1",
    });
    expect(byKey[KeyVars.QuickNodeApiKey]).toMatchObject({
      isSet: false,
      value: null,
    });
    expect(JSON.stringify(overview)).not.toContain("alchemy-secret");
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
