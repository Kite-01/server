import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { chain } from "../chain";

export const priceFeed = pgTable(
  "kite_price_feed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    baseCurrency: text("base_currency").notNull(),
    quoteCurrency: text("quote_currency").notNull(),
    address: text("address").notNull(),
    decimals: integer("decimals").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_price_feed_chain_id_idx").on(table.chainId),
    unique("kite_price_feed_base_currency_quote_currency_key").on(
      table.baseCurrency,
      table.quoteCurrency,
    ),
  ],
);

export const priceFeedRelations = relations(priceFeed, ({ one }) => ({
  chain: one(chain, { fields: [priceFeed.chainId], references: [chain.id] }),
}));
