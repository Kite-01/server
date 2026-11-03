import { beforeEach, describe, expect, it } from "vitest";
import {
  ApiKeyScope,
  KeyType,
  KeyVarPrefix,
  KeyVars,
  networkKeyVar,
  type KvKey,
} from "../../../shared/constants";
import { createApiKey, createApp } from "../../../test/factories";
import { client, rootCredentials } from "../../../test/api";
import { eq, inArray } from "drizzle-orm";
import { KvService } from "../../../services/Kv.service";
import { kv } from "../../../db/schema";
import { db } from "../../../db";

describe("configuration values", () => {
  beforeEach(async () => {
    const service = new KvService();

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
  });

  it("shows the root key every value, secure ones decrypted", async () => {
    const res = await client(rootCredentials()).get("/api/kv");
    const byKey = Object.fromEntries(
      res.json.map((row: { key: string }) => [row.key, row]),
    );

    expect(res.status).toBe(200);
    expect(byKey[KeyVars.AlchemyApiKey]).toMatchObject({
      type: KeyType.SecureString,
      value: "alchemy-secret",
    });

    expect(byKey[KeyVars.AlchemyGasPolicyId]).toMatchObject({
      type: KeyType.String,
      value: "policy-1",
    });
  });

  it("is not available to API keys", async () => {
    const key = await createApiKey((await createApp()).id, {
      scopes: Object.values(ApiKeyScope),
    });

    const res = await client(key.credentials).get("/api/kv");

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).not.toContain("alchemy-secret");
  });

  it("reports which providers have their keys set", async () => {
    const res = await client(rootCredentials()).get("/api/kv/providers");
    const byProvider = Object.fromEntries(
      res.json.map((row: { provider: string; action: string }) => [
        `${row.provider}:${row.action}`,
        row,
      ]),
    );

    expect(res.status).toBe(200);
    expect(byProvider["Alchemy:GasSponsor"]).toMatchObject({
      configured: true,
      keys: [
        { key: KeyVars.AlchemyApiKey, type: KeyType.SecureString, set: true },
        { key: KeyVars.AlchemyGasPolicyId, type: KeyType.String, set: true },
      ],
    });

    expect(byProvider["Alchemy:OnchainNotifier"]).toMatchObject({
      configured: false,
      keys: [{ key: KeyVars.AlchemyAuthToken, set: false }],
    });

    expect(byProvider["QuickNode:OnchainNotifier"]).toMatchObject({
      configured: false,
      keys: [{ key: KeyVars.QuickNodeApiKey, set: false }],
    });

    expect(byProvider["Thirdweb:GasSponsor"]).toMatchObject({
      configured: false,
      keys: [
        {
          key: KeyVars.ThirdwebSecretKey,
          type: KeyType.SecureString,
          set: false,
        },
      ],
    });

    expect(JSON.stringify(res.json)).not.toContain("alchemy-secret");
  });

  it("sets a provider key with the type it is stored as", async () => {
    const res = await client(rootCredentials()).put(
      `/api/kv/${KeyVars.QuickNodeApiKey}`,
      { value: "  qn-secret  " },
    );

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      key: KeyVars.QuickNodeApiKey,
      type: KeyType.SecureString,
    });
    expect((await new KvService().getKv(KeyVars.QuickNodeApiKey))?.value).toBe(
      "qn-secret",
    );

    const providers = await client(rootCredentials()).get("/api/kv/providers");
    expect(
      providers.json.find(
        (row: { provider: string }) => row.provider === "QuickNode",
      ).configured,
    ).toBe(true);
  });

  it("clears a provider key with null", async () => {
    const res = await client(rootCredentials()).put(
      `/api/kv/${KeyVars.AlchemyGasPolicyId}`,
      { value: null },
    );

    expect(res.status).toBe(200);
    expect(
      (await new KvService().getKv(KeyVars.AlchemyGasPolicyId))?.value,
    ).toBeNull();
  });

  it("drops the webhooks made under a QuickNode key once it changes", async () => {
    const service = new KvService();
    const base = networkKeyVar(
      KeyVarPrefix.QuickNodeEvmWalletFilter_WebhookId,
      "base-mainnet",
    );
    const ethereum = networkKeyVar(
      KeyVarPrefix.QuickNodeEvmContractEvents_WebhookId,
      "ethereum-mainnet",
    );

    await service.setKey(KeyVars.QuickNodeApiKey, "first");
    for (const key of [base, ethereum]) {
      await service.upsertKv({ key, type: KeyType.String, value: "webhook" });
    }

    await service.setKey(KeyVars.QuickNodeApiKey, "first");
    expect((await service.getKv(base))?.value).toBe("webhook");

    await service.setKey(KeyVars.QuickNodeApiKey, "second");
    expect(await service.getKv(base)).toBeNull();
    expect(await service.getKv(ethereum)).toBeNull();
    expect((await service.getKv(KeyVars.QuickNodeApiKey))?.value).toBe(
      "second",
    );
  });

  it("sets keys the server manages, with the type they are stored as", async () => {
    const res = await client(rootCredentials()).put(
      `/api/kv/${KeyVars.QuickNodeWebhookSecurityToken}`,
      { value: "token" },
    );

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      key: KeyVars.QuickNodeWebhookSecurityToken,
      type: KeyType.SecureString,
      value: "token",
    });

    const [row] = await db
      .select()
      .from(kv)
      .where(eq(kv.key, KeyVars.QuickNodeWebhookSecurityToken));
    expect(row?.value).toMatch(/^cipher\./);
  });

  it("sets a per-network key", async () => {
    const key = networkKeyVar(
      KeyVarPrefix.AlchemyAddressActivity_Webhook,
      "BASE_MAINNET",
    );

    const res = await client(rootCredentials()).put(
      `/api/kv/${encodeURIComponent(key)}`,
      { value: '{"id":"wh_1","signingKey":"sk"}' },
    );

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ key, type: KeyType.SecureString });
  });

  it("does not set keys the server doesn't read", async () => {
    const keys = [
      "Unknown",
      "AlchemyAddressActivity_Webhooks",
      `${KeyVarPrefix.QuickNodeEvmWalletFilter_WebhookId}:`,
      `${KeyVarPrefix.QuickNodeEvmWalletFilter_WebhookId}:base mainnet`,
    ];

    for (const key of keys) {
      const res = await client(rootCredentials()).put(
        `/api/kv/${encodeURIComponent(key)}`,
        { value: "value" },
      );

      expect(res.status).toBe(422);
    }

    expect(await new KvService().getKvs(keys as KvKey[])).toEqual([]);
  });

  it("does not let API keys set provider keys", async () => {
    const key = await createApiKey((await createApp()).id, {
      scopes: Object.values(ApiKeyScope),
    });

    const res = await client(key.credentials).put(
      `/api/kv/${KeyVars.AlchemyApiKey}`,
      { value: "stolen" },
    );

    expect(res.status).toBe(403);
    expect((await new KvService().getKv(KeyVars.AlchemyApiKey))?.value).toBe(
      "alchemy-secret",
    );
  });

  it("deletes a value", async () => {
    const service = new KvService();
    const key = networkKeyVar(
      KeyVarPrefix.QuickNodeEvmWalletFilter_WebhookId,
      "base-mainnet",
    );
    await service.setKey(key, "webhook");

    const res = await client(rootCredentials()).delete(
      `/api/kv/${encodeURIComponent(key)}`,
    );

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ key });
    expect(await service.getKv(key)).toBeNull();
    expect(await service.getKv(KeyVars.AlchemyApiKey)).not.toBeNull();
  });

  it("deletes rows the server no longer reads or can't decrypt", async () => {
    const legacy = "AlchemyAddressActivity_Webhooks" as KvKey;
    await db.insert(kv).values([
      { key: legacy, type: KeyType.String, value: "old" },
      {
        key: KeyVars.ThirdwebSecretKey,
        type: KeyType.SecureString,
        value: "cipher.broken",
      },
    ]);

    for (const key of [legacy, KeyVars.ThirdwebSecretKey]) {
      const res = await client(rootCredentials()).delete(`/api/kv/${key}`);
      expect(res.status).toBe(200);
    }

    expect(
      await db
        .select()
        .from(kv)
        .where(inArray(kv.key, [legacy, KeyVars.ThirdwebSecretKey])),
    ).toEqual([]);
  });

  it("drops the webhooks made under a provider key it deletes", async () => {
    const service = new KvService();
    const webhook = networkKeyVar(
      KeyVarPrefix.AlchemyContractEvents_Webhook,
      "BASE_MAINNET",
    );
    await service.setKey(KeyVars.AlchemyAuthToken, "token");
    await service.setKey(webhook, "webhook");

    const res = await client(rootCredentials()).delete(
      `/api/kv/${KeyVars.AlchemyAuthToken}`,
    );

    expect(res.status).toBe(200);
    expect(await service.getKv(webhook)).toBeNull();
  });

  it("answers 404 for a key that isn't stored", async () => {
    const res = await client(rootCredentials()).delete(
      `/api/kv/${KeyVars.NearIntentsApiKey}`,
    );

    expect(res.status).toBe(404);
  });

  it("does not let API keys delete values", async () => {
    const key = await createApiKey((await createApp()).id, {
      scopes: Object.values(ApiKeyScope),
    });

    const res = await client(key.credentials).delete(
      `/api/kv/${KeyVars.AlchemyApiKey}`,
    );

    expect(res.status).toBe(403);
    expect(await new KvService().getKv(KeyVars.AlchemyApiKey)).not.toBeNull();
  });
});
