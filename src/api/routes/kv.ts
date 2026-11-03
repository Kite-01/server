import { KeyVarPrefix, KeyVars, type KvKey } from "../../shared/constants";
import { KvService } from "../../services/Kv.service";
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
      operationId: "kv.list",
      security: [{ rootKey: [] }],
      tags: ["Kv"],
      summary: "List configuration values",
    },
  })
  .get("/kv/providers", () => kv.getProviderStatuses(), {
    response: {
      200: "ProviderStatusList",
    },
    detail: {
      operationId: "kv.listProviders",
      security: [{ rootKey: [] }],
      tags: ["Kv"],
      summary: "List providers secrets configuration status",
    },
  })
  .put(
    "/kv/:key",
    ({ params, body }) => kv.setKey(params.key as KvKey, body.value),
    {
      parse: "json",
      params: t.Object({
        key: t.Union([
          t.Enum(KeyVars),
          t.String({
            pattern: `^(?:${Object.values(KeyVarPrefix).join("|")}):[A-Za-z0-9_-]+$`,
          }),
        ]),
      }),
      body: t.Object({
        value: t.Union([t.String({ minLength: 1 }), t.Null()]),
      }),
      response: {
        200: "KvEntry",
      },
      detail: {
        operationId: "kv.set",
        security: [{ rootKey: [] }],
        tags: ["Kv"],
        summary: "Set a configuration value",
      },
    },
  )
  .delete(
    "/kv/:key",
    async ({ params }) => {
      await kv.deleteKey(params.key);
      return {
        key: params.key,
      };
    },
    {
      params: t.Object({ key: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({
          key: t.String(),
        }),
      },
      detail: {
        operationId: "kv.delete",
        security: [{ rootKey: [] }],
        tags: ["Kv"],
        summary: "Delete a configuration value",
      },
    },
  );
