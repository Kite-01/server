import { drizzle, type PostgresJsSession } from "drizzle-orm/postgres-js";
import { type ExtractTablesWithRelations } from "drizzle-orm";
import { type Sql } from "postgres";
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

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseOrTransaction = Database | Transaction;

type Session = PostgresJsSession<
  Sql,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export const dbWithTransaction = (tx: Transaction) => {
  const client = (tx._.session as Session).client;

  return {
    executeSql: async (text: string, values?: unknown[]) => {
      return {
        rows: await client.unsafe(text, values as never[]),
      };
    },
  };
};
