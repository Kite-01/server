import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { quote } from "../quote";
import { fee } from "../fee";

export const quoteFee = pgTable(
  "kite_quote_fee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    feeId: uuid("fee_id").references(() => fee.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    amount: numeric("amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    feeAddress: text("fee_address").notNull(),
    blockchainHash: text("blockchain_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("kite_quote_fee_quote_id_idx").on(table.quoteId),
    check("kite_quote_fee_amount_check", sql`${table.amount} >= 0`),
  ],
);

export const quoteFeeRelations = relations(quoteFee, ({ one }) => ({
  quote: one(quote, { fields: [quoteFee.quoteId], references: [quote.id] }),
}));
