import {
  pgTable,
  uuid,
  integer,
  text,
  jsonb,
  timestamp,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { webhook } from "../webhook";
import { event } from "../event";

export const webhookDelivery = pgTable(
  "kite_webhook_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "restrict" }),
    attempt: integer("attempt").notNull(),
    error: text("error"),
    httpResponseCode: integer("http_response_code"),
    httpResponseHeaders: jsonb("http_response_headers"),
    httpResponseBody: text("http_response_body"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("kite_webhook_delivery_event_id_webhook_id_attempt_key").on(
      table.eventId,
      table.webhookId,
      table.attempt,
    ),
    index("kite_webhook_delivery_webhook_id_idx").on(table.webhookId),
    check("kite_webhook_delivery_attempt_check", sql`${table.attempt} > 0`),
  ],
);

export const webhookDeliveryRelations = relations(
  webhookDelivery,
  ({ one }) => ({
    webhook: one(webhook, {
      fields: [webhookDelivery.webhookId],
      references: [webhook.id],
    }),
    event: one(event, {
      fields: [webhookDelivery.eventId],
      references: [event.id],
    }),
  }),
);
