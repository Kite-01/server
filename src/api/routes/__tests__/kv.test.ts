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
});
