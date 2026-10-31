import { EvmAddress, PageQuery, t, Uuid } from "../schema";
import { ApiKeyScope } from "../../shared/constants";
import { AppService } from "../../services/App.service";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";

const appService = new AppService();

const Url = t.Union([
  t.String({
    format: "uri",
    maxLength: 2048,
  }),
  t.Null(),
]);

const Fields = {
  name: t.String({
    minLength: 1,
    maxLength: 120,
  }),
  icon: t.Union([
    t.String({
      format: "uri",
      maxLength: 2048,
    }),
    t.Null(),
  ]),
  websiteUrl: Url,
  termsOfServiceUrl: Url,
  privacyPolicyUrl: Url,
  payoutAsset: t.Union([t.String({ minLength: 1, maxLength: 256 }), t.Null()]),
  payoutAddress: t.Union([
    t.String({ minLength: 1, maxLength: 256 }),
    t.Null(),
  ]),
};

const ChainParams = t.Object({ chainId: Uuid });

export const appRoutes = new Elysia({ name: "AppsRoute" })
  .use(Auth.plugin)
  .use(models)
  .get("/apps/all", ({ query }) => appService.getApps(query), {
    query: t.Object({
      q: t.Optional(t.String({ maxLength: 100 })),
      ...PageQuery,
    }),
    response: {
      200: "AppPage",
    },
    beforeHandle: Auth.access({ root: true }),
    detail: {
      operationId: "apps.list",
      security: [{ rootKey: [] }],
      tags: ["Apps"],
      summary: "List apps",
    },
  })
  .post(
    "/apps",
    async ({ body, set }) => {
      const created = await appService.createApp(body);
      set.status = 201;
      return created;
    },
    {
      parse: "json",
      body: t.Composite([
        t.Pick(t.Object(Fields), ["name"]),
        t.Partial(t.Omit(t.Object(Fields), ["name"])),
      ]),
      response: {
        201: "App",
      },
      beforeHandle: Auth.access({ root: true }),
      detail: {
        operationId: "apps.create",
        security: [{ rootKey: [] }],
        tags: ["Apps"],
        summary: "Create an app",
      },
    },
  )
  .get(
    "/apps",
    async ({ actor }) => {
      const appId = Auth.requireAppId(actor);
      const app = await appService.getApp(appId);

      if (!app) throw new HttpError(404, "NotFound", "App not found");
      return app;
    },
    {
      response: {
        200: "App",
      },
      detail: {
        operationId: "apps.get",
        tags: ["Apps"],
        summary: "Get app",
      },
    },
  )
  .patch(
    "/apps",
    async ({ actor, body }) => {
      const appId = Auth.requireAppId(actor);
      const app = await appService.updateApp(appId, body);

      if (!app) throw new HttpError(404, "NotFound", "App not found");
      return app;
    },
    {
      parse: "json",
      body: t.Partial(t.Object(Fields)),
      response: {
        200: "App",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.AppWrite }),
      detail: {
        operationId: "apps.update",
        tags: ["Apps"],
        summary: "Update app",
      },
    },
  )
  .delete(
    "/apps",
    async ({ actor }) => {
      const appId = Auth.requireAppId(actor);
      const app = await appService.deleteApp(appId);

      if (!app) throw new HttpError(404, "NotFound", "App not found");
      return app;
    },
    {
      response: {
        200: "App",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.AppDelete }),
      detail: {
        operationId: "apps.delete",
        tags: ["Apps"],
        summary: "Delete app",
      },
    },
  )
  .get(
    "/apps/chains",
    async ({ actor }) => {
      const appId = Auth.requireAppId(actor);
      const data = await appService.getChains(appId);
      return { data };
    },
    {
      response: {
        200: "AppChainList",
      },
      detail: {
        operationId: "apps.listChains",
        tags: ["Apps"],
        summary: "Chains the app takes payments on",
      },
    },
  )
  .put(
    "/apps/chains/:chainId",
    ({ actor, params, body }) => {
      return appService.setChain(
        Auth.requireAppId(actor),
        params.chainId,
        body.address,
      );
    },
    {
      parse: "json",
      params: ChainParams,
      body: t.Object({ address: EvmAddress }),
      response: {
        200: "AppChain",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.AppWrite }),
      detail: {
        operationId: "apps.setChain",
        tags: ["Apps"],
        summary: "Take payments on a chain, paid to an address there",
      },
    },
  )
  .delete(
    "/apps/chains/:chainId",
    async ({ actor, params }) => {
      const row = await appService.removeChain(
        Auth.requireAppId(actor),
        params.chainId,
      );

      if (!row) {
        throw new HttpError(
          404,
          "NotFound",
          "The app doesn't take payments on this chain",
        );
      }

      return row;
    },
    {
      params: ChainParams,
      response: {
        200: "AppChain",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.AppWrite }),
      detail: {
        operationId: "apps.removeChain",
        tags: ["Apps"],
        summary: "Stop taking payments on a chain",
      },
    },
  );
