import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  check,
  foreignKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { transferTimeline } from "../transferTimeline";
import { TransferStatus } from "../../../shared/constants";
import { sql, relations } from "drizzle-orm";
import { deposit } from "../deposit";
import { quote } from "../quote";
import { app } from "../app";

export const transfer = pgTable(
  "kite_transfer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id").notNull(),
    settlementRecipient: text("settlement_recipient").notNull(),
    minAmountOut: numeric("min_amount_out", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    refundAddress: text("refund_address").notNull(),
    payinAddress: text("payin_address").notNull(),
    status: text("status", { enum: toEnum(TransferStatus) }).notNull(),
    settlementBlockchainHash: text("settlement_blockchain_hash"),
    refundBlockchainHash: text("refund_blockchain_hash"),
    x402Payer: text("x402_payer"),
    x402AuthorizationNonce: text("x402_authorization_nonce"),
    x402AuthorizationHash: text("x402_authorization_hash"),
    x402BlockchainHash: text("x402_blockchain_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_transfer_app_id_idx").on(table.appId),
    uniqueIndex("kite_transfer_quote_id_key").on(table.quoteId),
    uniqueIndex("kite_transfer_payin_address_key").on(table.payinAddress),
    check(
      "kite_transfer_status_check",
      sql`${table.status} IN (${toSqlList(toEnum(TransferStatus))})`,
    ),
    foreignKey({
      name: "kite_transfer_quote_app_fk",
      columns: [table.quoteId, table.appId],
      foreignColumns: [quote.id, quote.appId],
    }).onDelete("restrict"),
  ],
);

export const transferRelations = relations(transfer, ({ one, many }) => ({
  quote: one(quote, { fields: [transfer.quoteId], references: [quote.id] }),
  app: one(app, { fields: [transfer.appId], references: [app.id] }),
  timeline: many(transferTimeline),
  deposits: many(deposit),
}));
