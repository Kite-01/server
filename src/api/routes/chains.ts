import { Digits, EvmAddress, t, Uuid, UuidIdParams } from "../schema";
import { ChainService } from "../../services/Chain.service";
import { HttpError } from "../../shared/errors";
import { Provider } from "../../shared/constants";
import { getChain } from "../../shared/chains";
import { Chains } from "../../shared/chains/registry";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";

const chainService = new ChainService();

const Providers = t.Array(t.Enum(Provider), {
  uniqueItems: true,
});

export const chainRoutes = new Elysia({ name: "ChainsRoute" })
  .use(Auth.plugin)
  .use(models)
  .get(
    "/chains",
    async () => {
      const chains = await chainService.getActiveChains();

      return {
        data: chains.flatMap((chain) =>
          chain.config
            ? [
                {
                  id: chain.id,
                  caip2Id: chain.caip2Id,
                  name: getChain(chain.caip2Id).name,
                  settlementToken: chain.config.settlementToken,
                  usdPeggedToken: chain.config.usdPeggedToken,
                },
              ]
            : [],
        ),
      };
    },
    {
      response: {
        200: "ConfiguredChainList",
      },
      beforeHandle: Auth.access({ public: true }),
      detail: {
        tags: ["Chains"],
        summary: "List configured chains",
      },
    },
  )
  .get("/chains/full", () => chainService.getChains(), {
    response: {
      200: "ChainWithConfigList",
    },
    beforeHandle: Auth.access({ root: true }),
    detail: {
      tags: ["Chains"],
      summary: "List chains (with full metadata)",
    },
  })
  .get(
    "/chains/supported",
    () => {
      return Object.values(Chains).map((chain) => ({
        caip2Id: chain.caip2Id,
        name: chain.name,
        chainId: chain.chainId,
        nativeCurrency: chain.nativeCurrency,
        blockExplorer: chain.blockExplorer,
        confirmations: chain.confirmations,
      }));
    },
    {
      response: {
        200: "SupportedChainList",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        tags: ["Chains"],
        summary: "Chains this server knows how to run on",
      },
    },
  )
  .post(
    "/chains",
    async ({ body, set }) => {
      const created = await chainService.createChain(
        body as { caip2Id: Caip2Id },
      );

      set.status = 201;
      return created;
    },
    {
      parse: "json",
      body: t.Object({
        caip2Id: t.String({ pattern: "^eip155:[0-9]+$" }),
      }),
      response: {
        201: "Chain",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        tags: ["Chains"],
        summary: "Add a chain",
      },
    },
  )
  .patch(
    "/chains/:id",
    async ({ params, body }) => {
      const chain = await chainService.updateChainActiveStatus(
        params.id,
        body.isActive,
      );

      if (!chain) throw new HttpError(404, "NotFound", "Chain not found");
      return chain;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({ isActive: t.Boolean() }),
      response: {
        200: "Chain",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        tags: ["Chains"],
        summary: "Update chain active status",
      },
    },
  )
  .put(
    "/chains/:id/config",
    async ({ params, body }) => {
      await chainService.upsertChainConfig(params.id, {
        ...body,
        rpcUrls: body.rpcUrls ?? null,
        settlementAddress: body.settlementAddress ?? null,
        maxGasPrice:
          body.maxGasPrice === undefined || body.maxGasPrice === null
            ? null
            : BigInt(body.maxGasPrice),
      });

      const chain = await chainService.getChainById(params.id);
      if (!chain) throw new HttpError(404, "NotFound", "Chain not found");
      return chain;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        rpcUrls: t.Optional(
          t.Union([
            t.Array(
              t.String({
                format: "uri",
                pattern: "^https?://",
              }),
              { maxItems: 10 },
            ),
            t.Null(),
          ]),
        ),
        slippageBps: t.Integer({
          minimum: 0,
          maximum: 9900,
        }),
        kiteFactoryAddress: EvmAddress,
        usdPeggedTokenId: Uuid,
        settlementTokenId: Uuid,
        settlementAddress: t.Optional(t.Union([EvmAddress, t.Null()])),
        onchainNotifierProviders: Providers,
        gasSponsorProviders: Providers,
        maxGasPrice: t.Optional(t.Union([Digits, t.Null()])),
      }),
      response: {
        200: "ChainWithConfig",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        tags: ["Chains"],
        summary: "Configure a chain",
      },
    },
  )
  .delete(
    "/chains/:id",
    async ({ params }) => {
      const chain = await chainService.deleteChain(params.id);
      if (!chain) throw new HttpError(404, "NotFound", "Chain not found");
      return chain;
    },
    {
      params: UuidIdParams,
      response: {
        200: "Chain",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        tags: ["Chains"],
        summary: "Delete a chain",
      },
    },
  );
