import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { transfer } from "../transfer";
import { event } from "../event";

export const transferTimeline = pgTable(
  "kite_transfer_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfer.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").references(() => event.id, {
      onDelete: "restrict",
    }),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("kite_transfer_timeline_transfer_id_idx").on(table.transferId),
    index("kite_transfer_timeline_event_id_idx").on(table.eventId),
  ],
);

export const transferTimelineRelations = relations(
  transferTimeline,
  ({ one }) => ({
    transfer: one(transfer, {
      fields: [transferTimeline.transferId],
      references: [transfer.id],
    }),
    event: one(event, {
      fields: [transferTimeline.eventId],
      references: [event.id],
    }),
  }),
);
