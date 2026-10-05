import {
  pgTable,
  uuid,
  numeric,
  timestamp,
  index,
  foreignKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { transfer } from "../transfer";
import { chain } from "../chain";
import { token } from "../token";

export const deposit = pgTable(
  "kite_deposit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull(),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    tokenId: uuid("token_id").notNull(),
    amount: numeric("amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    senderAddress: text("sender_address").notNull(),
    blockchainHash: text("blockchain_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("kite_deposit_chain_id_idx").on(table.chainId),
    index("kite_deposit_token_id_idx").on(table.tokenId),
    index("kite_deposit_address_idx").on(table.address),
    foreignKey({
      name: "kite_deposit_token_chain_fk",
      columns: [table.tokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
    uniqueIndex("kite_deposit_address_blockchain_hash_token_id_key").on(
      table.address,
      table.blockchainHash,
      table.tokenId,
    ),
  ],
);

export const depositRelations = relations(deposit, ({ one }) => ({
  chain: one(chain, { fields: [deposit.chainId], references: [chain.id] }),
  token: one(token, { fields: [deposit.tokenId], references: [token.id] }),
  transfer: one(transfer, {
    fields: [deposit.address],
    references: [transfer.payinAddress],
  }),
}));
