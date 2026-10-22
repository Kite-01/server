import { t, UuidIdParams, PageQuery } from "../schema";
import { ApiKeyService } from "../../services/ApiKey.service";
import { ApiKeyScope } from "../../shared/constants";
import { HttpError } from "../../shared/errors";
import { signing } from "../../shared/signing";
import { models } from "../models";
import { Elysia } from "elysia";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";

const apiKeyService = new ApiKeyService();

export const apiKeyRoutes = new Elysia({ name: "ApiKeysRoute" })
  .use(Auth.plugin)
  .use(models)
  .post(
    "/api-key",
    async ({ actor, body, set }) => {
      if (!signing.isPublicKey(body.publicKey)) {
        throw new HttpError(
          400,
          "BadRequest",
          '"publicKey" must be a base64url Ed25519 public key',
        );
      }

      if (
        actor.kind === "app" &&
        body.scopes.some((scope) => !actor.scopes.includes(scope))
      ) {
        throw new HttpError(
          403,
          "Forbidden",
          "Cannot grant scopes the calling key lacks",
        );
      }

      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new HttpError(
          400,
          "BadRequest",
          '"expiresAt" must be in the future',
        );
      }

      const created = await apiKeyService.createApiKey({
        appId: Auth.requireAppId(actor),
        label: body.label,
        publicKey: body.publicKey,
        scopes: body.scopes,
        expiresAt,
      });

      set.status = 201;

      return created;
    },
    {
      beforeHandle: Auth.access({ scope: ApiKeyScope.ApiKeyWrite }),
      parse: "json",
      body: t.Object({
        label: t.String({
          minLength: 1,
          maxLength: 120,
        }),
        publicKey: t.String({
          minLength: 43,
          maxLength: 43,
        }),
        scopes: t.Array(t.Enum(ApiKeyScope), {
          uniqueItems: true,
        }),
        expiresAt: t.Optional(
          t.String({
            format: "date-time",
          }),
        ),
      }),
      response: {
        201: "ApiKey",
      },
      detail: {
        operationId: "apiKeys.create",
        tags: ["API key"],
        summary: "Register an API key's public key",
      },
    },
  )
  .get(
    "/api-key",
    ({ actor, query }) => {
      return apiKeyService.getApiKeys({
        ...query,
        appId: actor.appId,
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 100 })),
        ...PageQuery,
      }),
      response: {
        200: "ApiKeyPage",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.ApiKeyRead }),
      detail: {
        operationId: "apiKeys.list",
        tags: ["API key"],
        summary: "List API keys",
      },
    },
  )
  .get(
    "/api-key/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "apiKey", params.id);
      const entry = await apiKeyService.getApiKey(appId, params.id);

      if (!entry) throw new HttpError(404, "NotFound", "API key not found");
      return entry;
    },
    {
      params: UuidIdParams,
      response: {
        200: "ApiKey",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.ApiKeyRead }),
      detail: {
        operationId: "apiKeys.get",
        tags: ["API key"],
        summary: "Get an API key",
      },
    },
  )
  .patch(
    "/api-key/:id",
    async ({ actor, params, body }) => {
      const appId = await Scope.appFor(actor, "apiKey", params.id);
      const entry = await apiKeyService.updateApiKey(appId, params.id, body);

      if (!entry) throw new HttpError(404, "NotFound", "API key not found");
      return entry;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        label: t.String({
          minLength: 1,
          maxLength: 120,
        }),
      }),
      response: {
        200: "ApiKey",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.ApiKeyWrite }),
      detail: {
        operationId: "apiKeys.update",
        tags: ["API key"],
        summary: "Update an API key's label",
      },
    },
  )
  .post(
    "/api-key/:id/revoke",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "apiKey", params.id);
      const entry = await apiKeyService.revokeApiKey(appId, params.id);

      if (!entry) throw new HttpError(404, "NotFound", "API key not found");
      return entry;
    },
    {
      params: UuidIdParams,
      response: {
        200: "ApiKey",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.ApiKeyWrite }),
      detail: {
        operationId: "apiKeys.revoke",
        tags: ["API key"],
        summary: "Revoke an API key",
      },
    },
  )
  .delete(
    "/api-key/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "apiKey", params.id);
      const entry = await apiKeyService.deleteApiKey(appId, params.id);

      if (!entry) throw new HttpError(404, "NotFound", "API key not found");
      return entry;
    },
    {
      params: UuidIdParams,
      response: {
        200: "ApiKey",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.ApiKeyWrite }),
      detail: {
        operationId: "apiKeys.delete",
        tags: ["API key"],
        summary: "Delete an API key",
      },
    },
  );
