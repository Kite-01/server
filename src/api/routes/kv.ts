import { KvService } from "../../services/Kv.service";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";

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
  });
