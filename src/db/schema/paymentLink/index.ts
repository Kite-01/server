import {
  pgTable,
  uuid,
  timestamp,
  index,
  text,
  check,
  numeric,
} from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { PaymentLinkType } from "../../../shared/constants";
import { relations, sql } from "drizzle-orm";
import { quote } from "../quote";
import { app } from "../app";

export const paymentLink = pgTable(
  "kite_payment_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    title: text("text").notNull(),
    currency: text("currency").notNull(),
    mode: text("mode", { enum: toEnum(PaymentLinkType) }).notNull(),
    amount: numeric("amount", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    lineItems: uuid("line_items"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("kite_payment_link_app_id_idx").on(table.appId),
    index("kite_payment_link_currency_idx").on(table.currency),
    check(
      "kite_payment_link_mode_check",
      sql`${table.mode} IN (${toSqlList(toEnum(PaymentLinkType))})`,
    ),
  ],
);

export const paymentLinksRelations = relations(
  paymentLink,
  ({ many, one }) => ({
    quotes: many(quote),
    app: one(app, { fields: [paymentLink.appId], references: [app.id] }),
  }),
);
