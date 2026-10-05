import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { toEnum, toSqlList } from "../utils";
import { ApiKeyScope } from "../../../shared/constants";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { app } from "../app";

export const apiKey = pgTable(
  "kite_api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    publicKey: text("public_key").notNull(),
    scopes: text("scopes", { enum: toEnum(ApiKeyScope) })
      .array()
      .notNull(),
    allowedOrigins: text("allowed_origins").array(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_api_key_app_id_idx").on(table.appId),
    check(
      "kite_api_key_scopes_check",
      sql`${table.scopes} <@ ARRAY[${toSqlList(toEnum(ApiKeyScope))}]::text[]`,
    ),
  ],
);

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  app: one(app, { fields: [apiKey.appId], references: [app.id] }),
}));
