import { ApiKeyScope, OneMinute } from "../../shared/constants";
import { ApiKeyService } from "../../services/ApiKey.service";
import { AppService } from "../../services/App.service";
import { HttpError } from "../../shared/errors";
import { readBody } from "./readBody";
import { signing } from "../../shared/signing";
import { common } from "../../shared/common";
import { Elysia } from "elysia";
import { env } from "../../shared/env";

export type Actor =
  | { kind: "root"; appId?: string }
  | {
      kind: "app";
      appId: string;
      apiKeyId: string;
      scopes: ApiKeyScope[];
    };

export type Access = {
  scope?: ApiKeyScope;
  root?: boolean;
};

const rawBodies = new WeakMap<Request, string>();
const MaxClockSkewSeconds = 5 * OneMinute;
const UuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Auth {
  static getHeader = (request: Request, name: string) => {
    return request.headers.get(name)?.trim() || undefined;
  };

  static authorize = (actor: Actor, access: Access) => {
    if (actor.kind === "root") return;
    if (access.root) {
      throw new HttpError(403, "Forbidden", "x-kite-root-key is missing");
    }

    if (access.scope && !actor.scopes.includes(access.scope)) {
      throw new HttpError(403, "Forbidden", "Cannot access resource");
    }
  };

  static authenticate = async (request: Request): Promise<Actor> => {
    const rootKey = Auth.getHeader(request, "x-kite-root-key");
    if (rootKey) {
      if (!common.safeCompare(rootKey, env.KITE_ROOT_KEY)) {
        throw new HttpError(401, "Unauthorized", "Invalid root key");
      }

      const appId = Auth.getHeader(request, "x-kite-app-id");
      if (appId) {
        if (!UuidPattern.test(appId)) {
          throw new HttpError(400, "BadRequest", "Invalid x-kite-app-id");
        }

        const exists = await new AppService().doesAppExist(appId);
        if (!exists) throw new HttpError(404, "NotFound", "App not found");
      }

      return { kind: "root", appId };
    }

    const keyId = Auth.getHeader(request, "x-kite-api-key-id");
    if (!keyId) {
      throw new HttpError(401, "Unauthorized", "x-kite-api-key-id is required");
    }

    const signature = Auth.getHeader(request, "x-kite-signature");
    if (!signature) {
      throw new HttpError(401, "Unauthorized", "x-kite-signature is required");
    }

    const nonce = Auth.getHeader(request, "x-kite-nonce");
    const timestamp = Auth.getHeader(request, "x-kite-timestamp");

    if (!nonce) {
      throw new HttpError(401, "Unauthorized", "x-kite-nonce is required");
    }

    if (!timestamp) {
      throw new HttpError(401, "Unauthorized", "x-kite-timestamp is required");
    }

    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!/^\d{1,12}$/.test(timestamp) || !(skew <= MaxClockSkewSeconds)) {
      throw new HttpError(
        401,
        "Unauthorized",
        "Request timestamp is outside the allowed window",
      );
    }

    if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) {
      throw new HttpError(401, "Unauthorized", "Nonce format is invalid");
    }

    if (!UuidPattern.test(keyId)) {
      throw new HttpError(401, "Unauthorized", "Invalid API key");
    }

    const apiKeyService = new ApiKeyService();
    const apiKey = await apiKeyService.getApiKeyWithApp(keyId);
    const usable =
      !!apiKey &&
      !apiKey.revokedAt &&
      (!apiKey.expiresAt || apiKey.expiresAt > new Date()) &&
      !apiKey.app.deletedAt;

    if (!usable) throw new HttpError(401, "Unauthorized", "Invalid API key");

    const url = new URL(request.url);
    const signed = {
      timestamp,
      nonce,
      method: request.method,
      target: `${url.pathname}${url.search}`,
      body: rawBodies.get(request) ?? "",
    };

    const publicKey = signing.toPublicKey(apiKey.publicKey);
    const valid = !!publicKey && signing.verify(publicKey, signed, signature);

    if (!valid) throw new HttpError(401, "Unauthorized", "Invalid signature");
    if (!(await apiKeyService.consumeNonce(keyId, nonce))) {
      throw new HttpError(401, "Unauthorized", "Nonce has already been used");
    }

    void apiKeyService
      .updateApiKeyLastUsed(apiKey.appId, apiKey.id)
      .catch(() => null);

    return {
      kind: "app",
      appId: apiKey.appId,
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes,
    };
  };

  static requireAppId = (actor: Actor) => {
    if (!actor.appId) {
      throw new HttpError(400, "BadRequest", "x-kite-app-id is required");
    }

    return actor.appId;
  };

  static access = (rule: Access) => {
    return ({ actor }: { actor: Actor }) => {
      return Auth.authorize(actor, rule);
    };
  };

  static parseJson = async (
    { request }: { request: Request },
    contentType: string,
  ) => {
    const body = await readBody(request, 1024 * 1024);
    const text = body.toString("utf8");

    rawBodies.set(request, text);

    if (!text) return null;
    if (!contentType.includes("json")) {
      throw new HttpError(
        400,
        "BadRequest",
        "Request bodies must be application/json",
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "BadRequest", "Request body is not valid JSON");
    }
  };

  static plugin = new Elysia({ name: "KiteAuth" })
    .onParse({ as: "scoped" }, Auth.parseJson)
    .derive({ as: "scoped" }, async ({ request }) => ({
      actor: await Auth.authenticate(request),
    }));
}
