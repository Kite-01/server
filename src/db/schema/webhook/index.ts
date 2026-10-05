import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { webhookDelivery } from "../webhookDelivery";
import { WebhookCategory } from "../../../shared/constants";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { app } from "../app";

export const webhook = pgTable(
  "kite_webhook",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    label: text("label").notNull(),
    categories: text("categories", { enum: toEnum(WebhookCategory) })
      .array()
      .notNull(),
    signingKey: text("signing_key").notNull(),
    signingKeyHint: text("signing_key_hint").notNull(),
    maxRetries: integer("max_retries").notNull().default(0),
    retryIntervalInSeconds: integer("retry_interval_in_seconds")
      .notNull()
      .default(10),
    timeoutInSeconds: integer("timeout_in_seconds").notNull().default(60),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("kite_webhook_app_id_url_key").on(table.appId, table.url),
    check(
      "kite_webhook_categories_nonempty_check",
      sql`cardinality(${table.categories}) > 0`,
    ),
    check(
      "kite_webhook_categories_check",
      sql`${table.categories} <@ ARRAY[${toSqlList(toEnum(WebhookCategory))}]::text[]`,
    ),
    check("kite_webhook_max_retries_check", sql`${table.maxRetries} >= 0`),
    check(
      "kite_webhook_timeout_in_seconds_check",
      sql`${table.timeoutInSeconds} > 0`,
    ),
    check(
      "kite_webhook_retry_interval_in_seconds_check",
      sql`${table.retryIntervalInSeconds} > 0`,
    ),
  ],
);

export const webhookRelations = relations(webhook, ({ one, many }) => ({
  app: one(app, { fields: [webhook.appId], references: [app.id] }),
  deliveries: many(webhookDelivery),
}));
