import { EvmAddress, PageQuery, Uuid, UuidIdParams } from "../schema";
import { TokenService } from "../../services/Token.service";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const tokenService = new TokenService();

export const tokenRoutes = new Elysia({ name: "TokensRoute" })
  .use(Auth.plugin)
  .use(models)
  .get("/tokens", ({ query }) => tokenService.getTokens(query), {
    query: t.Object({
      chainId: t.Optional(Uuid),
      q: t.Optional(t.String({ maxLength: 100 })),
      ...PageQuery,
    }),
    response: {
      200: "TokenPage",
    },
    beforeHandle: Auth.access({ public: true }),
    detail: {
      tags: ["Tokens"],
      summary: "List tokens",
    },
  })
  .get(
    "/tokens/:chainId/:address",
    ({ params }) => {
      return tokenService.getTokenByAddress(params.chainId, params.address);
    },
    {
      params: t.Object({
        chainId: Uuid,
        address: EvmAddress,
      }),
      response: {
        200: "TokenWithChain",
      },
      beforeHandle: Auth.access({ public: true }),
      detail: {
        tags: ["Tokens"],
        summary: "Get a token by its contract address",
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
        tags: ["Tokens"],
        summary: "Delete a token",
      },
    },
  );
