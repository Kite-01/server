import { EvmAddress, PageQuery, Uuid, UuidIdParams } from "../schema";
import { TokenService } from "../../services/Token.service";
import { HttpError } from "../../shared/errors";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const tokenService = new TokenService();

export const tokenRoutes = new Elysia({ name: "TokensRoute" })
  .use(Auth.plugin)
  .get("/tokens", ({ query }) => tokenService.getTokens(query), {
    query: t.Object({
      chainId: t.Optional(Uuid),
      q: t.Optional(t.String({ maxLength: 100 })),
      ...PageQuery,
    }),
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
      beforeHandle: Auth.access({ root: true }),
      detail: {
        tags: ["Tokens"],
        summary: "Delete a token",
      },
    },
  );
