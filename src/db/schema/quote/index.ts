import {
  pgTable,
  uuid,
  numeric,
  integer,
  text,
  jsonb,
  timestamp,
  check,
  index,
  unique,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { paymentLink } from "../paymentLink";
import { customer } from "../customer";
import { quoteFee } from "../quoteFee";
import { transfer } from "../transfer";
import { chain } from "../chain";
import { token } from "../token";
import { app } from "../app";

export const quote = pgTable(
  "kite_quote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    paymentLinkId: uuid("payment_link_id").references(() => paymentLink.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => customer.id, {
      onDelete: "set null",
    }),
    sourceTokenId: uuid("source_token_id").notNull(),
    targetTokenId: uuid("target_token_id").notNull(),
    sourceUsdAmount: numeric("source_usd_amount", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    sourceAmount: numeric("source_amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    targetAmount: numeric("target_amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    targetUsdAmount: numeric("target_usd_amount", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    rate: numeric("rate", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    uniswapPoolFeeTier: integer("uniswap_pool_fee_tier"),
    reference: text("reference"),
    meta: jsonb("meta"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_quote_app_id_idx").on(table.appId),
    index("kite_quote_chain_id_idx").on(table.chainId),
    index("kite_quote_payment_link_id_idx").on(table.paymentLinkId),
    index("kite_quote_customer_id_idx").on(table.customerId),
    index("kite_quote_source_token_id_idx").on(table.sourceTokenId),
    index("kite_quote_target_token_id_idx").on(table.targetTokenId),
    unique("kite_quote_id_app_id_key").on(table.id, table.appId),
    uniqueIndex("kite_quote_app_id_reference_key").on(
      table.appId,
      table.reference,
    ),
    check(
      "kite_quote_amounts_check",
      sql`${table.sourceAmount} > 0 AND ${table.targetAmount} > 0 AND ${table.rate} > 0`,
    ),
    foreignKey({
      name: "kite_quote_source_token_id_fk",
      columns: [table.sourceTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
    foreignKey({
      name: "kite_quote_target_token_id_fk",
      columns: [table.targetTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
  ],
);

export const quoteRelations = relations(quote, ({ one, many }) => ({
  app: one(app, { fields: [quote.appId], references: [app.id] }),
  chain: one(chain, { fields: [quote.chainId], references: [chain.id] }),
  paymentLink: one(paymentLink, {
    fields: [quote.paymentLinkId],
    references: [paymentLink.id],
  }),
  customer: one(customer, {
    fields: [quote.customerId],
    references: [customer.id],
  }),
  sourceToken: one(token, {
    fields: [quote.sourceTokenId],
    references: [token.id],
    relationName: "kite_quote_source_token",
  }),
  targetToken: one(token, {
    fields: [quote.targetTokenId],
    references: [token.id],
    relationName: "kite_quote_target_token",
  }),
  fees: many(quoteFee),
  transfer: one(transfer),
}));
