import { WebhookCategory } from "../../shared/constants";
import { SystemService } from "../../services/System.service";
import { EventService } from "../../services/Event.service";
import { StatsService } from "../../services/Stats.service";
import { PageQuery } from "../schema";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

export const overviewRoutes = new Elysia({
  name: "OverviewRoute",
  prefix: "/overview",
})
  .use(Auth.plugin)
  .onBeforeHandle(Auth.access({ root: true }))
  .get("/info", () => new SystemService().getInfo(), {
    detail: {
      tags: ["Overview"],
      summary: "Service version & operator address",
    },
  })
  .get(
    "/stats",
    ({ actor, query }) => {
      return new StatsService().getStats({
        appId: actor.appId,
        from: new Date(query.from),
        to: new Date(query.to),
        timeZone: query.timeZone,
        rank: query.rank,
      });
    },
    {
      query: t.Object({
        from: t.String({
          format: "date-time",
        }),
        to: t.String({
          format: "date-time",
        }),
        timeZone: t.Optional(
          t.String({
            maxLength: 64,
          }),
        ),
        rank: t.Optional(t.Union([t.Literal("volume"), t.Literal("value")])),
      }),
      detail: {
        tags: ["Overview"],
        summary: "Basic dashboard statistics",
      },
    },
  )
  .get(
    "/events",
    ({ actor, query }) => {
      return new EventService().getEvents({
        ...query,
        appId: actor.appId,
      });
    },
    {
      query: t.Object({
        category: t.Optional(t.Enum(WebhookCategory)),
        ...PageQuery,
      }),
      detail: {
        tags: ["Overview"],
        summary: "Recent events",
      },
    },
  );
