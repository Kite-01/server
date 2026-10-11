import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { quote } from "../quote";
import { app } from "../app";

export const customer = pgTable(
  "kite_customer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    name: text("name"),
    traits: jsonb("traits").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("kite_customer_id_app_id_key").on(table.id, table.appId),
    uniqueIndex("kite_customer_app_id_external_id_key").on(
      table.appId,
      table.externalId,
    ),
  ],
);

export const customerRelations = relations(customer, ({ one, many }) => ({
  quotes: many(quote),
  app: one(app, {
    fields: [customer.appId],
    references: [app.id],
  }),
}));
