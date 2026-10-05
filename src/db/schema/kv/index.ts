import { pgTable, timestamp, text, check } from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { KeyType, KeyVars } from "../../../shared/constants";
import { sql } from "drizzle-orm";

export const kv = pgTable(
  "kite_kv",
  {
    key: text("key", { enum: toEnum(KeyVars) }).primaryKey(),
    type: text("type", { enum: toEnum(KeyType) }).notNull(),
    value: text("value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "kite_kv_key_check",
      sql`${table.key} IN (${toSqlList(toEnum(KeyVars))})`,
    ),
  ],
);
