import {
  pgTable,
  uuid,
  text,
  jsonb,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { PayoutStatus } from "../../../shared/constants";
import { relations } from "drizzle-orm";
import { transfer } from "../transfer";
import { toEnum } from "../utils";

export const payout = pgTable("kite_payout", {
  transferId: uuid("transfer_id")
    .primaryKey()
    .references(() => transfer.id, { onDelete: "restrict" }),
  depositAddress: text("deposit_address").notNull(),
  destinationAsset: text("destination_asset").notNull(),
  destinationSymbol: text("destination_symbol").notNull(),
  destinationChain: text("destination_chain").notNull(),
  recipient: text("recipient").notNull(),
  refundTo: text("refund_to").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  status: text("status", { enum: toEnum(PayoutStatus) }).notNull(),
  quote: jsonb("quote").$type<Record<string, unknown>>().notNull(), // 1Click's signed quote, kept whole for disputes
  amountOut: numeric("amount_out", { precision: 78, scale: 0, mode: "bigint" }),
  refundedAmount: numeric("refunded_amount", {
    precision: 78,
    scale: 0,
    mode: "bigint",
  }),
  blockchainHash: text("blockchain_hash"),
  explorerUrl: text("explorer_url"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const payoutRelations = relations(payout, ({ one }) => ({
  transfer: one(transfer, {
    fields: [payout.transferId],
    references: [transfer.id],
  }),
}));
