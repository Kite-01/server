import {
  pgTable,
  uuid,
  timestamp,
  index,
  text,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
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
    lineItems: jsonb("line_items"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_payment_link_app_id_idx").on(table.appId),
    index("kite_payment_link_currency_idx").on(table.currency),
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
