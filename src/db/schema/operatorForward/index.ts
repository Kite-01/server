import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import {
  OperatorForwardKind,
  OperatorForwardStatus,
} from "../../../shared/constants";
import { toEnum, toSqlList } from "../utils";
import { relations, sql } from "drizzle-orm";
import { transfer } from "../transfer";
import { token } from "../token";

export const operatorForward = pgTable(
  "kite_operator_forward",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfer.id, { onDelete: "restrict" }),
    sourceId: text("source_id").notNull(),
    sourceBlockchainHash: text("source_blockchain_hash").notNull(),
    kind: text("kind", { enum: toEnum(OperatorForwardKind) }).notNull(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => token.id, { onDelete: "restrict" }),
    amount: numeric("amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    recipient: text("recipient"),
    status: text("status", { enum: toEnum(OperatorForwardStatus) }).notNull(),
    reason: text("reason"),
    callId: text("call_id"),
    error: text("error"),
    blockchainHash: text("blockchain_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("kite_operator_forward_source_id_key").on(table.sourceId),
    index("kite_operator_forward_transfer_id_idx").on(table.transferId),
    index("kite_operator_forward_token_id_idx").on(table.tokenId),
    index("kite_operator_forward_status_idx").on(table.status),
    check("kite_operator_forward_amount_check", sql`${table.amount} > 0`),
    check(
      "kite_operator_forward_kind_check",
      sql`${table.kind} IN (${toSqlList(toEnum(OperatorForwardKind))})`,
    ),
    check(
      "kite_operator_forward_status_check",
      sql`${table.status} IN (${toSqlList(toEnum(OperatorForwardStatus))})`,
    ),
  ],
);

export const operatorForwardRelations = relations(
  operatorForward,
  ({ one }) => ({
    transfer: one(transfer, {
      fields: [operatorForward.transferId],
      references: [transfer.id],
    }),
    token: one(token, {
      fields: [operatorForward.tokenId],
      references: [token.id],
    }),
  }),
);
