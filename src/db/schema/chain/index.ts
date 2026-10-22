import {
  pgTable,
  boolean,
  timestamp,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { chainConfig } from "../chainConfig";
import { priceFeed } from "../priceFeed";
import { quote } from "../quote";
import { token } from "../token";
import { fee } from "../fee";

export const chain = pgTable(
  "kite_chain",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    isActive: boolean("is_active").notNull().default(true),
    caip2Id: text("caip2_id").notNull().$type<Caip2Id>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("kite_chain_caip2_id_active_key")
      .on(table.caip2Id)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const chainRelations = relations(chain, ({ one, many }) => ({
  config: one(chainConfig),
  priceFeeds: many(priceFeed),
  tokens: many(token),
  quotes: many(quote),
  fees: many(fee),
}));
