import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../shared/env";
import * as schema from "./schema";
import postgres from "postgres";

export const sql = postgres(env.KITE_PG_DB_URL, {
  max: 10,
  prepare: false,
});

export const db = drizzle(sql, {
  schema,
});
