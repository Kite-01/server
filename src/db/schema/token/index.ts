import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  check,
  unique,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { chainConfig } from "../chainConfig";
import { chain } from "../chain";
import { quote } from "../quote";

export const token = pgTable(
  "kite_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    address: text("address").notNull(),
    symbol: text("symbol").notNull(),
    decimals: integer("decimals").notNull(),
    name: text("name").notNull(),
    version: text("version"),
    icon: text("icon"),
    supportsEIP3009: boolean("supports_eip3009").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_token_chain_id_idx").on(table.chainId),
    unique("kite_token_id_chain_id_key").on(table.id, table.chainId),
    check(
      "kite_token_decimals_check",
      sql`${table.decimals} BETWEEN 0 AND 255`,
    ),
    uniqueIndex("kite_token_chain_id_address_key").on(
      table.chainId,
      table.address,
    ),
  ],
);

export const tokenRelations = relations(token, ({ one, many }) => ({
  chain: one(chain, { fields: [token.chainId], references: [chain.id] }),
  quotesAsSource: many(quote, { relationName: "kite_quote_source_token" }),
  quotesAsTarget: many(quote, { relationName: "kite_quote_target_token" }),
  settlementFor: many(chainConfig),
}));
