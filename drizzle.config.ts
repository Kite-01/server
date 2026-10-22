import { defineConfig } from "drizzle-kit";
import { env } from "./src/shared/env";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.KITE_PG_DB_URL,
  },
});
