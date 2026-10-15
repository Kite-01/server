import { KvService } from "../../services/Kv.service";
import { KeyVars } from "../../shared/constants";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const kv = new KvService();

export const kvRoutes = new Elysia({ name: "KvRoute" })
  .use(Auth.plugin)
  .use(models)
  .onBeforeHandle(Auth.access({ root: true }))
  .get("/kv", () => kv.getKvs(), {
    response: {
      200: "KvEntryList",
    },
    detail: {
      tags: ["Kv"],
      summary: "List configuration values",
    },
  })
  .get("/kv/providers", () => kv.getProviderStatuses(), {
    response: {
      200: "ProviderStatusList",
    },
    detail: {
      tags: ["Kv"],
      summary: "List providers secrets configuration status",
    },
  })
  .put(
    "/kv/:key",
    ({ params, body }) => kv.setProviderKey(params.key, body.value),
    {
      parse: "json",
      params: t.Object({ key: t.Enum(KeyVars) }),
      body: t.Object({
        value: t.Union([t.String({ minLength: 1 }), t.Null()]),
      }),
      response: {
        200: "KvEntry",
      },
      detail: {
        tags: ["Kv"],
        summary: "Set a provider key",
      },
    },
  );
