import { beforeEach, describe, expect, it } from "vitest";
import { KeyType, KeyVars, ApiKeyScope } from "../../../shared/constants";
import { createApiKey, createApp } from "../../../test/factories";
import { client, rootCredentials } from "../../../test/api";
import { KvService } from "../../../services/Kv.service";

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
    await service.setProviderKey(KeyVars.QuickNodeApiKey, "first");
    await service.upsertKv({
      key: KeyVars.QuickNodeEvmWalletFilter_WebhookId,
      type: KeyType.String,
      value: "webhook-1",
    });

    await service.setProviderKey(KeyVars.QuickNodeApiKey, "first");
    expect(
      (await service.getKv(KeyVars.QuickNodeEvmWalletFilter_WebhookId))?.value,
    ).toBe("webhook-1");

    await service.setProviderKey(KeyVars.QuickNodeApiKey, "second");
    expect(
      await service.getKv(KeyVars.QuickNodeEvmWalletFilter_WebhookId),
    ).toBeNull();
  });

  it("does not set keys the server manages", async () => {
    const res = await client(rootCredentials()).put(
      `/api/kv/${KeyVars.QuickNodeWebhookSecurityToken}`,
      { value: "forged" },
    );

    expect(res.status).toBe(400);
    expect(
      await new KvService().getKv(KeyVars.QuickNodeWebhookSecurityToken),
    ).toBeNull();
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
});
