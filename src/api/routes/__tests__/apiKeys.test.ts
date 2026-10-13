import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey, createApp } from "../../../test/factories";
import { client, rootCredentials } from "../../../test/api";
import { ApiKeyScope } from "../../../shared/constants";
import { signing } from "../../../shared/signing";

describe("API keys", () => {
  let appId: string;
  let admin: ReturnType<typeof client>;

  beforeEach(async () => {
    const app = await createApp();
    appId = app.id;

    const key = await createApiKey(appId, {
      scopes: [
        ApiKeyScope.ApiKeyRead,
        ApiKeyScope.ApiKeyWrite,
        ApiKeyScope.QuoteRead,
      ],
    });

    admin = client(key.credentials);
  });

  const registration = (overrides: Record<string, unknown> = {}) => ({
    label: "Backend",
    publicKey: signing.generateKeyPair().publicKey,
    scopes: [ApiKeyScope.QuoteRead],
    ...overrides,
  });

  it("registers a public key that can then sign requests", async () => {
    const pair = signing.generateKeyPair();
    const created = await admin.post("/api/api-key", {
      ...registration({ publicKey: pair.publicKey }),
      allowedOrigins: ["https://test.app"],
    });

    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      appId,
      label: "Backend",
      publicKey: pair.publicKey,
      scopes: [ApiKeyScope.QuoteRead],
      allowedOrigins: ["https://test.app"],
      revokedAt: null,
    });

    const asNewKey = client({
      keyId: created.json.id,
      privateKey: pair.privateKey,
    });

    const res = await asNewKey.get("/api/app");
    expect(res.status).toBe(200);
  });

  it("will not grant scopes the caller lacks", async () => {
    const res = await admin.post(
      "/api/api-key",
      registration({ scopes: [ApiKeyScope.TransferWrite] }),
    );

    expect(res.status).toBe(403);
  });

  it.each([
    ["a public key that is not Ed25519", { publicKey: "!".repeat(43) }, 400],
    ["a past expiry", { expiresAt: "2020-01-01T00:00:00.000Z" }, 400],
    ["an unknown scope", { scopes: ["everything"] }, 422],
    ["an invalid origin", { allowedOrigins: ["test.app"] }, 422],
    ["an empty label", { label: "" }, 422],
  ])("rejects %s", async (_label, overrides, status) => {
    const res = await admin.post("/api/api-key", registration(overrides));

    expect(res.status).toBe(status);
  });

  it("lets the root key register keys for an app, and only for an app", async () => {
    const root = client(rootCredentials(appId));
    const rootNoApp = client(rootCredentials());

    const ok = await root.post(
      "/api/api-key",
      registration({
        scopes: Object.values(ApiKeyScope),
      }),
    );

    const missing = await rootNoApp.post("/api/api-key", registration());

    expect(ok.status).toBe(201);
    expect(missing.status).toBe(400);
  });

  it("lists, reads, renames, revokes and deletes keys of its own app", async () => {
    const other = await createApiKey(appId, {
      label: "Other",
    });

    const list = await admin.get("/api/api-key", {
      pageSize: 1,
    });

    expect(list.json).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
    });

    const read = await admin.get(`/api/api-key/${other.row.id}`);
    expect(read.json.label).toBe("Other");

    const renamed = await admin.patch(`/api/api-key/${other.row.id}`, {
      label: "Renamed",
    });

    expect(renamed.json.label).toBe("Renamed");

    const revoked = await admin.post(`/api/api-key/${other.row.id}/revoke`);
    expect(revoked.json.revokedAt).toBeTruthy();

    expect((await client(other.credentials).get("/api/app")).status).toBe(401);

    const deleted = await admin.delete(`/api/api-key/${other.row.id}`);
    expect(deleted.status).toBe(200);

    const res = await admin.get(`/api/api-key/${other.row.id}`);
    expect(res.status).toBe(404);
  });

  it("cannot see or touch another app's keys", async () => {
    const otherApp = await createApp();
    const foreign = await createApiKey(otherApp.id);

    for (const res of [
      await admin.get(`/api/api-key/${foreign.row.id}`),
      await admin.patch(`/api/api-key/${foreign.row.id}`, { label: "x" }),
      await admin.post(`/api/api-key/${foreign.row.id}/revoke`),
      await admin.delete(`/api/api-key/${foreign.row.id}`),
    ]) {
      expect(res.status).toBe(404);
    }

    const listed = await admin.get("/api/api-key");
    expect(listed.json.data.map((k: { id: string }) => k.id)).not.toContain(
      foreign.row.id,
    );
  });

  it("lets the root key work across apps without naming one", async () => {
    const otherApp = await createApp();
    const foreign = await createApiKey(otherApp.id);
    const root = client(rootCredentials());

    const res1 = await root.get(`/api/api-key/${foreign.row.id}`);
    const res2 = await root.get("/api/api-key");
    const res3 = await root.post(`/api/api-key/${foreign.row.id}/revoke`);

    expect(res1.status).toBe(200);
    expect(res2.json.total).toBeGreaterThanOrEqual(2);
    expect(res3.json.revokedAt).toBeTruthy();
  });

  it("requires the matching scope", async () => {
    const apiKey = await createApiKey(appId, {
      scopes: [ApiKeyScope.ApiKeyRead],
    });

    const readOnly = client(apiKey.credentials);

    const res1 = await readOnly.get("/api/api-key");
    const res2 = await readOnly.post("/api/api-key", registration());

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(403);

    const res3 = await client((await createApiKey(appId)).credentials).get(
      "/api/api-key",
    );

    expect(res3.status).toBe(403);
  });

  it("rejects ids that are not uuids", async () => {
    const res = await admin.get("/api/api-key/not-a-uuid");
    expect(res.status).toBe(422);
  });
});
