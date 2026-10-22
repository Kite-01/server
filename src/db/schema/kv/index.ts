import { pgTable, timestamp, text } from "drizzle-orm/pg-core";
import { KeyType, type KvKey } from "../../../shared/constants";
import { toEnum } from "../utils";

export const kv = pgTable("kite_kv", {
  key: text("key").$type<KvKey>().primaryKey(),
  type: text("type", { enum: toEnum(KeyType) }).notNull(),
  value: text("value"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
