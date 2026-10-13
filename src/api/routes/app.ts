import { PageQuery, t } from "../schema";
import { ApiKeyScope } from "../../shared/constants";
import { AppService } from "../../services/App.service";
import { HttpError } from "../../shared/errors";
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
};

export const appRoutes = new Elysia({ name: "AppsRoute" })
  .use(Auth.plugin)
  .get("/apps/all", ({ query }) => appService.getApps(query), {
    query: t.Object({
      q: t.Optional(t.String({ maxLength: 100 })),
      ...PageQuery,
    }),
    beforeHandle: Auth.access({ root: true }),
    detail: {
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
      body: t.Composite([
        t.Pick(t.Object(Fields), ["name"]),
        t.Partial(t.Omit(t.Object(Fields), ["name"])),
      ]),
      beforeHandle: Auth.access({ root: true }),
      detail: {
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
      beforeHandle: Auth.access({ public: true }),
      detail: {
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
      body: t.Partial(t.Object(Fields)),
      beforeHandle: Auth.access({ scope: ApiKeyScope.AppWrite }),
      detail: {
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
      beforeHandle: Auth.access({ scope: ApiKeyScope.AppDelete }),
      detail: {
        tags: ["Apps"],
        summary: "Delete app",
      },
    },
  );
