import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  foreignKey,
  numeric,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { Provider } from "../../../shared/constants";
import { toEnum } from "../utils";
import { token } from "../token";
import { chain } from "../chain";

export const chainConfig = pgTable(
  "kite_chain_config",
  {
    chainId: uuid("chain_id")
      .primaryKey()
      .references(() => chain.id, { onDelete: "cascade" }),
    rpcUrls: text("rpc_urls").array(),
    slippageBps: integer("slippage_bps").notNull(),
    kiteFactoryAddress: text("kite_factory_address").notNull(),
    usdPeggedTokenId: uuid("usd_pegged_token_id").notNull(),
    settlementTokenId: uuid("settlement_token_id").notNull(),
    onchainNotifierProviders: text("onchain_notifier_providers", {
      enum: toEnum(Provider),
    })
      .array()
      .notNull(),
    gasSponsorProviders: text("gas_sponsor_providers", {
      enum: toEnum(Provider),
    })
      .array()
      .notNull(),
    maxGasPrice: numeric("max_gas_price", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("kite_chain_config_settlement_token_id_idx").on(
      table.settlementTokenId,
    ),
    foreignKey({
      name: "kite_chain_config_settlement_token_fk",
      columns: [table.settlementTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
    foreignKey({
      name: "kite_chain_config_usd_pegged_token_fk",
      columns: [table.usdPeggedTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
  ],
);

export const chainConfigRelations = relations(chainConfig, ({ one }) => ({
  chain: one(chain, {
    fields: [chainConfig.chainId],
    references: [chain.id],
  }),
  settlementToken: one(token, {
    fields: [chainConfig.settlementTokenId],
    references: [token.id],
  }),
  usdPeggedToken: one(token, {
    fields: [chainConfig.usdPeggedTokenId],
    references: [token.id],
  }),
}));
