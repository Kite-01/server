import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const apiNonce = pgTable(
  "kite_api_nonce",
  {
    keyId: text("key_id").notNull(),
    nonce: text("nonce").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyId, table.nonce] }),
    index("kite_api_nonce_created_at_idx").on(table.createdAt),
  ],
);
