import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  text,
  numeric,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { PaymentLinkUsage } from "../../../shared/constants";
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
    title: text("title").notNull(),
    currency: text("currency").notNull(),
    amount: numeric("amount", {
      precision: 38,
      scale: 18,
      mode: "string",
    }).notNull(),
    usage: text("usage", { enum: toEnum(PaymentLinkUsage) })
      .notNull()
      .default(PaymentLinkUsage.OneTime),
    lineItems: jsonb("line_items"),
    reference: text("reference"),
    meta: jsonb("meta"),
    returnUrl: text("return_url"),
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
      "kite_payment_link_usage_check",
      sql`${table.usage} IN (${toSqlList(toEnum(PaymentLinkUsage))})`,
    ),
    index("kite_payment_link_app_id_idx").on(table.appId),
    index("kite_payment_link_currency_idx").on(table.currency),
    uniqueIndex("kite_payment_link_app_id_reference_key").on(
      table.appId,
      table.reference,
    ),
  ],
);

export const paymentLinksRelations = relations(
  paymentLink,
  ({ many, one }) => ({
    quotes: many(quote),
    app: one(app, {
      fields: [paymentLink.appId],
      references: [app.id],
    }),
  }),
);
