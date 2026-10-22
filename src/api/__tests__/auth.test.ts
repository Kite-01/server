import {
  rootCredentials,
  signedHeaders,
  signedCall,
  call,
  app,
} from "../../test/api";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey, createApp } from "../../test/factories";
import { ApiKeyService } from "../../services/ApiKey.service";
import { ApiKeyScope } from "../../shared/constants";
import { AppService } from "../../services/App.service";
import { signing } from "../../shared/signing";
import { rootKey } from "../../test/rootKey";

const send = async (
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body,
    }),
  );

  return {
    status: response.status,
    text: await response.text(),
  };
};

describe("API authentication", () => {
  let appId: string;
  let key: Awaited<ReturnType<typeof createApiKey>>;

  beforeEach(async () => {
    const app = await createApp({ name: "Test app" });

    appId = app.id;
    key = await createApiKey(appId, {
      scopes: [ApiKeyScope.AppWrite],
    });
  });

  describe("signed requests", () => {
    it("accepts an app key and returns the app it belongs to", async () => {
      const res = await signedCall(key.credentials, "GET", "/api/apps");

      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        id: appId,
        name: "Test app",
      });
    });

    it("accepts the root key acting as an app", async () => {
      const res = await signedCall(rootCredentials(appId), "GET", "/api/apps");

      expect(res.status).toBe(200);
      expect(res.json.id).toBe(appId);
    });

    it("signs the query string and the body", async () => {
      const res = await signedCall(key.credentials, "PATCH", "/api/apps", {
        body: {
          name: "Renamed",
        },
      });

      expect(res.status).toBe(200);
      expect(res.json.name).toBe("Renamed");
    });

    it.each([
      [
        "a missing key id",
        (h: Record<string, string>) => ({ ...h, "x-kite-api-key-id": "" }),
      ],
      [
        "a missing signature",
        (h: Record<string, string>) => ({ ...h, "x-kite-signature": "" }),
      ],
      [
        "a missing timestamp",
        (h: Record<string, string>) => ({ ...h, "x-kite-timestamp": "" }),
      ],
      [
        "a missing nonce",
        (h: Record<string, string>) => ({ ...h, "x-kite-nonce": "" }),
      ],
      [
        "a garbage signature",
        (h: Record<string, string>) => ({ ...h, "x-kite-signature": "AAAA" }),
      ],
      [
        "a short nonce",
        (h: Record<string, string>) => ({ ...h, "x-kite-nonce": "abc" }),
      ],
      [
        "a non-numeric timestamp",
        (h: Record<string, string>) => ({
          ...h,
          "x-kite-timestamp": "yesterday",
        }),
      ],
    ])("rejects %s", async (_label, mutate) => {
      const headers = mutate(
        signedHeaders(key.credentials, "GET", "/api/apps"),
      );
      const res = await call("GET", "/api/apps", headers);

      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe("Unauthorized");
    });

    it("rejects a signature made by another key", async () => {
      const other = signing.generateKeyPair();
      const res = await signedCall(
        { keyId: key.credentials.keyId, privateKey: other.privateKey },
        "GET",
        "/api/apps",
      );

      expect(res.status).toBe(401);
    });

    it("rejects a signature replayed against another path, method or body", async () => {
      const headers = signedHeaders(key.credentials, "GET", "/api/apps");

      expect((await call("GET", "/api/apps?x=1", headers)).status).toBe(401);
      expect((await call("DELETE", "/api/apps", headers)).status).toBe(401);

      const signedForBody = signedHeaders(
        key.credentials,
        "PATCH",
        "/api/apps",
        { body: { name: "A" } },
      );

      const res = await call("PATCH", "/api/apps", signedForBody, {
        body: { name: "B" },
      });

      expect(res.status).toBe(401);
    });

    it("rejects timestamps outside five minutes either way", async () => {
      const now = Math.floor(Date.now() / 1000);

      for (const timestamp of [now - 6 * 60, now + 6 * 60]) {
        const res = await signedCall(key.credentials, "GET", "/api/apps", {
          timestamp,
        });

        expect(res.status).toBe(401);
        expect(res.json.error.message).toMatch(/timestamp/);
      }

      const near = await signedCall(key.credentials, "GET", "/api/apps", {
        timestamp: now - 4 * 60,
      });

      expect(near.status).toBe(200);
    });

    it("accepts a nonce once", async () => {
      const first = await signedCall(key.credentials, "GET", "/api/apps", {
        nonce: "replay-nonce-0001",
      });

      const second = await signedCall(key.credentials, "GET", "/api/apps", {
        nonce: "replay-nonce-0001",
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(second.json.error.message).toMatch(/nonce/i);
    });

    it("lets two keys use the same nonce", async () => {
      const other = await createApiKey(appId);
      const res1 = await signedCall(key.credentials, "GET", "/api/apps", {
        nonce: "shared-nonce-001",
      });

      const res2 = await signedCall(other.credentials, "GET", "/api/apps", {
        nonce: "shared-nonce-001",
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it("does not burn a nonce on an invalid signature", async () => {
      const nonce = "burn-nonce-00001";
      const other = signing.generateKeyPair();

      await signedCall(
        { keyId: key.credentials.keyId, privateKey: other.privateKey },
        "GET",
        "/api/apps",
        { nonce },
      );

      const res = await signedCall(key.credentials, "GET", "/api/apps", {
        nonce,
      });

      expect(res.status).toBe(200);
    });

    it("rejects revoked, expired and unknown keys and keys of deleted apps", async () => {
      const revoked = await createApiKey(appId, { revokedAt: new Date() });
      const expired = await createApiKey(appId, {
        expiresAt: new Date(Date.now() - 1000),
      });

      for (const credentials of [
        revoked.credentials,
        expired.credentials,
        { ...key.credentials, keyId: crypto.randomUUID() },
        { ...key.credentials, keyId: "not-a-uuid" },
      ]) {
        const res = await signedCall(credentials, "GET", "/api/apps");
        expect(res.status).toBe(401);
      }

      await new AppService().deleteApp(appId);

      const res = await signedCall(key.credentials, "GET", "/api/apps");
      expect(res.status).toBe(401);
    });

    it("stops accepting a key as soon as it is revoked", async () => {
      const res1 = await signedCall(key.credentials, "GET", "/api/apps");
      expect(res1.status).toBe(200);

      await new ApiKeyService().revokeApiKey(appId, key.row.id);

      const res2 = await signedCall(key.credentials, "GET", "/api/apps");
      expect(res2.status).toBe(401);
    });

    it("records when a key was last used", async () => {
      await signedCall(key.credentials, "GET", "/api/apps");
      await expect
        .poll(
          async () =>
            (await new ApiKeyService().getApiKey(appId, key.row.id))
              ?.lastUsedAt,
        )
        .toBeInstanceOf(Date);
    });
  });

  describe("root key", () => {
    it("needs an app to act on an app resource", async () => {
      const res = await signedCall(rootCredentials(), "GET", "/api/apps");

      expect(res.status).toBe(400);
      expect(res.json.error.message).toMatch(/x-kite-app-id/);
    });

    it("rejects an unknown or malformed app id", async () => {
      const res1 = await signedCall(
        rootCredentials("nope"),
        "GET",
        "/api/apps",
      );
      const res2 = await signedCall(
        rootCredentials(crypto.randomUUID()),
        "GET",
        "/api/apps",
      );

      expect(res1.status).toBe(400);
      expect(res2.status).toBe(404);
    });

    it("authenticates with the x-kite-root-key header alone", async () => {
      const res = await call("GET", "/api/overview/info", {
        "x-kite-root-key": rootKey,
      });

      expect(res.status).toBe(200);
    });

    it("rejects any other value", async () => {
      for (const value of [`${rootKey}-not`, rootKey.slice(1), "x"]) {
        const res = await call("GET", "/api/overview/info", {
          "x-kite-root-key": value,
        });

        expect(res.status).toBe(401);
        expect(res.json.error.message).toBe("Invalid root key");
      }
    });

    it("does not fall back to an API key when the root key is wrong", async () => {
      const res = await call("GET", "/api/apps", {
        ...signedHeaders(key.credentials, "GET", "/api/apps"),
        "x-kite-root-key": "not the root key at all",
      });

      expect(res.status).toBe(401);
    });

    it("is not accepted as an API key id", async () => {
      const res = await signedCall(
        { keyId: "root", privateKey: signing.generateKeyPair().privateKey },
        "GET",
        "/api/apps",
      );

      expect(res.status).toBe(401);
    });

    it("cannot be sent as a public key", async () => {
      const res = await call("GET", "/api/apps", {
        "x-kite-api-key-id": "root",
        "x-kite-public-key": rootKey,
        "x-kite-app-id": appId,
      });

      expect(res.status).toBe(401);
    });

    it("is not an app key: an app key cannot borrow another app with x-kite-app-id", async () => {
      const other = await createApp({ name: "Other" });
      const res = await signedCall(
        { ...key.credentials, appId: other.id },
        "GET",
        "/api/apps",
      );

      expect(res.json.id).toBe(appId);
    });
  });

  describe("key id + public key", () => {
    it("is not a credential", async () => {
      const res = await call("GET", "/api/apps", {
        "x-kite-api-key-id": key.row.id,
        "x-kite-public-key": key.publicKey,
      });

      expect(res.status).toBe(401);
      expect(res.json.error.message).toBe("x-kite-signature is required");
    });
  });

  describe("scopes", () => {
    it("blocks a key without the required scope", async () => {
      const readOnly = await createApiKey(appId, {
        scopes: [ApiKeyScope.QuoteRead],
      });

      const res = await signedCall(readOnly.credentials, "PATCH", "/api/apps", {
        body: { name: "x" },
      });

      expect(res.status).toBe(403);
      expect(res.json.error.message).toBe("Cannot access resource");
    });

    it("lets the root key do anything", async () => {
      const res = await signedCall(
        rootCredentials(appId),
        "PATCH",
        "/api/apps",
        { body: { name: "By root" } },
      );

      expect(res.status).toBe(200);
    });
  });

  describe("request handling", () => {
    it("answers CORS preflights without credentials", async () => {
      const res = await call("OPTIONS", "/api/apps", {
        origin: "https://test.app",
        "access-control-request-method": "GET",
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const allowed = res.headers.get("access-control-allow-headers") ?? "";

      expect(allowed).not.toContain("x-kite-public-key");
      expect(allowed).toContain("x-kite-root-key");
    });

    it("returns json for unknown api routes", async () => {
      const res = await signedCall(key.credentials, "GET", "/api/nope");

      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe("NotFound");
    });

    it("validates bodies after authenticating", async () => {
      const unauth = await call(
        "PATCH",
        "/api/apps",
        { "content-type": "application/json" },
        { body: { name: 5 } },
      );

      const invalid = await signedCall(key.credentials, "PATCH", "/api/apps", {
        body: { name: 5 },
      });

      expect(unauth.status).toBe(401);
      expect(invalid.status).toBe(422);
      expect(invalid.json.error.code).toBe("ValidationError");
    });

    it("rejects malformed json and other content types", async () => {
      const headers = signedHeaders(key.credentials, "PATCH", "/api/apps", {
        body: { name: "x" },
      });

      const text = await send(
        "PATCH",
        "/api/apps",
        { ...headers, "content-type": "text/plain" },
        "{}",
      );

      expect(text.status).toBe(400);

      const broken = await send("PATCH", "/api/apps", headers, "{not json");
      expect(broken.status).toBe(400);
    });

    it("rejects bodies over 1 MiB before reading them all", async () => {
      const res = await send(
        "PATCH",
        "/api/apps",
        { "content-type": "application/json" },
        JSON.stringify({ name: "x".repeat(1024 * 1024 + 1) }),
      );

      expect(res.status).toBe(413);
    });

    it("adds the CORS header to api responses", async () => {
      const res = await signedCall(key.credentials, "GET", "/api/apps");

      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });
});
