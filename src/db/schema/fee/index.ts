import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { FeeType } from "../../../shared/constants";
import { toEnum } from "../utils";
import { chain } from "../chain";
import { app } from "../app";

export const fee = pgTable(
  "kite_fee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id").references(() => app.id, { onDelete: "restrict" }),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    type: text("type", { enum: toEnum(FeeType) }).notNull(),
    value: numeric("value", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    minAmountToCharge: numeric("min_amount_to_charge", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }),
    maxAmountToCharge: numeric("max_amount_to_charge", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }),
    condition: jsonb("condition").$type<Record<string, unknown>>().notNull(),
    feeAddress: text("fee_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_fee_app_id_idx").on(table.appId),
    index("kite_fee_chain_id_idx").on(table.chainId),
    check("kite_fee_value_check", sql`${table.value} >= 0`),
    check(
      "kite_fee_min_max_check",
      sql`${table.minAmountToCharge} IS NULL OR ${table.maxAmountToCharge} IS NULL OR ${table.minAmountToCharge} <= ${table.maxAmountToCharge}`,
    ),
  ],
);

export const feeRelations = relations(fee, ({ one }) => ({
  app: one(app, { fields: [fee.appId], references: [app.id] }),
  chain: one(chain, { fields: [fee.chainId], references: [chain.id] }),
}));
