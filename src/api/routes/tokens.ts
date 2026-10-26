import { EvmAddress, PageQuery, Uuid, UuidIdParams } from "../schema";
import { TokenService } from "../../services/Token.service";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const tokenService = new TokenService();

export const tokenRoutes = new Elysia({ name: "TokensRoute" })
  .use(models)
  .get(
    "/tokens/:chainId/:address",
    async ({ params, request }) => {
      const actor = Auth.getHeader(request, "x-kite-root-key")
        ? await Auth.authenticate(request)
        : null;

      return tokenService.getTokenByAddress(params.chainId, params.address, {
        listed: actor?.kind === "root",
      });
    },
    {
      params: t.Object({
        chainId: Uuid,
        address: EvmAddress,
      }),
      response: {
        200: "TokenWithChain",
      },
      detail: {
        operationId: "tokens.getByAddress",
        tags: ["Tokens"],
        summary: "Get a token by its contract address",
      },
    },
  )
  .use(Auth.plugin)
  .get("/tokens", ({ query }) => tokenService.getTokens(query), {
    query: t.Object({
      chainId: t.Optional(Uuid),
      q: t.Optional(t.String({ maxLength: 100 })),
      ...PageQuery,
    }),
    response: {
      200: "TokenPage",
    },
    detail: {
      operationId: "tokens.list",
      tags: ["Tokens"],
      summary: "List tokens",
    },
  })
  .patch(
    "/tokens/:id",
    async ({ params, body }) => {
      const token = await tokenService.updateTokenIcon(params.id, body.icon);
      if (!token) throw new HttpError(404, "NotFound", "Token not found");
      return token;
    },
    {
      parse: "json",
      params: UuidIdParams,
      body: t.Object({
        icon: t.Union([
          t.String({ format: "uri", pattern: "^https?://", maxLength: 2048 }),
          t.Null(),
        ]),
      }),
      response: {
        200: "Token",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        operationId: "tokens.update",
        security: [{ rootKey: [] }],
        tags: ["Tokens"],
        summary: "Change a token's icon",
      },
    },
  )
  .delete(
    "/tokens/:id",
    async ({ params }) => {
      const token = await tokenService.deleteToken(params.id);
      if (!token) throw new HttpError(404, "NotFound", "Token not found");
      return token;
    },
    {
      params: UuidIdParams,
      response: {
        200: "Token",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        operationId: "tokens.delete",
        security: [{ rootKey: [] }],
        tags: ["Tokens"],
        summary: "Delete a token",
      },
    },
  );
