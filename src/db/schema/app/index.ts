import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { paymentLink } from "../paymentLink";
import { relations } from "drizzle-orm";
import { customer } from "../customer";
import { transfer } from "../transfer";
import { webhook } from "../webhook";
import { apiKey } from "../apiKey";
import { quote } from "../quote";
import { event } from "../event";
import { fee } from "../fee";

export const app = pgTable("kite_app", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  icon: text("icon"),
  websiteUrl: text("website_url"),
  termsOfServiceUrl: text("terms_of_service_url"),
  privacyPolicyUrl: text("privacy_policy_url"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const appRelations = relations(app, ({ many }) => ({
  paymentLinks: many(paymentLink),
  customers: many(customer),
  transfers: many(transfer),
  webhooks: many(webhook),
  apiKeys: many(apiKey),
  events: many(event),
  quotes: many(quote),
  fees: many(fee),
}));
