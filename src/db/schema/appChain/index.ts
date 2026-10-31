import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { chain } from "../chain";
import { app } from "../app";

export const appChain = pgTable(
  "kite_app_chain",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.chainId] }),
    index("kite_app_chain_chain_id_idx").on(table.chainId),
  ],
);

export const appChainRelations = relations(appChain, ({ one }) => ({
  app: one(app, {
    fields: [appChain.appId],
    references: [app.id],
  }),
  chain: one(chain, {
    fields: [appChain.chainId],
    references: [chain.id],
  }),
}));
