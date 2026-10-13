import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { transferTimeline } from "../transferTimeline";
import { WebhookCategory } from "../../../shared/constants";
import { webhookDelivery } from "../webhookDelivery";
import { sql, relations } from "drizzle-orm";
import { app } from "../app";

export const event = pgTable(
  "kite_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id"),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    category: text("category", { enum: toEnum(WebhookCategory) }).notNull(),
    previousCategoryStatus: text("previous_category_status"),
    currentCategoryStatus: text("current_category_status").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("kite_event_app_id_idx").on(table.appId),
    index("kite_event_created_at_idx").on(table.createdAt),
    uniqueIndex("kite_event_source_id_key").on(table.sourceId),
    check(
      "kite_event_category_check",
      sql`${table.category} IN (${toSqlList(toEnum(WebhookCategory))})`,
    ),
  ],
);

export const eventRelations = relations(event, ({ one, many }) => ({
  deliveries: many(webhookDelivery),
  timelineEntries: many(transferTimeline),
  app: one(app, { fields: [event.appId], references: [app.id] }),
}));
