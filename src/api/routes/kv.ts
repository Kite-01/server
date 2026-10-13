import { KvService } from "../../services/Kv.service";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";

const kv = new KvService();

export const kvRoutes = new Elysia({ name: "KvRoute" })
  .use(Auth.plugin)
  .onBeforeHandle(Auth.access({ root: true }))
  .get("/kv", () => kv.getKvs(), {
    detail: {
      tags: ["Kv"],
      summary: "List configuration values",
    },
  });
