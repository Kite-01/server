import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  primaryKey,
  uniqueIndex,
  uuid,
  check,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";
import {
  ApiKeyScope,
  FeeType,
  TransferStatus,
  WebhookCategory,
} from "../shared/constants";
import { sql, relations } from "drizzle-orm";

const toEnum = <T extends string>(e: Record<string, T>) => {
  return Object.values(e) as [T, ...T[]];
};

const toSqlList = (values: readonly string[]) => {
  return sql.raw(values.map((v) => `'${v}'`).join(", "));
};

export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: text("value"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const chain = pgTable(
  "chain",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    isActive: boolean("is_active").notNull().default(true),
    caip2Id: text("caip2_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("chain_caip2_id_key").on(table.caip2Id)],
);

export const chainConfig = pgTable(
  "chain_config",
  {
    chainId: uuid("chain_id")
      .primaryKey()
      .references(() => chain.id, { onDelete: "cascade" }),
    rpcUrls: text("rpc_urls").array(),
    settlementTokenId: uuid("settlement_token_id").notNull(),
    settlementAddress: text("settlement_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("chain_config_settlement_token_id_idx").on(table.settlementTokenId),
    foreignKey({
      name: "chain_config_settlement_token_fk",
      columns: [table.settlementTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
  ],
);

export const chainAllowToken = pgTable(
  "chain_allow_token",
  {
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.tokenId] }),
    index("chain_allow_token_token_id_idx").on(table.tokenId),
    foreignKey({
      name: "chain_allow_token_token_chain_fk",
      columns: [table.tokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
  ],
);

export const chainDenyToken = pgTable(
  "chain_deny_token",
  {
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chainId, table.tokenId] }),
    index("chain_deny_token_token_id_idx").on(table.tokenId),
    foreignKey({
      name: "chain_deny_token_token_chain_fk",
      columns: [table.tokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
  ],
);

export const app = pgTable("app", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  icon: text("icon"),
  isParent: boolean("is_parent").notNull().default(false),
  websiteUrl: text("website_url"),
  termsOfServiceUrl: text("terms_of_service_url"),
  privacyPolicyUrl: text("privacy_policy_url"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const apiKey = pgTable(
  "api_key",
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
    index("api_key_app_id_idx").on(table.appId),
    check(
      "api_key_scopes_check",
      sql`${table.scopes} <@ ARRAY[${toSqlList(toEnum(ApiKeyScope))}]::text[]`,
    ),
  ],
);

export const customer = pgTable(
  "customer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    name: text("name"),
    traits: jsonb("traits").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("customer_app_id_external_id_key").on(
      table.appId,
      table.externalId,
    ),
  ],
);

export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    index("event_app_id_idx").on(table.appId),
    check(
      "event_category_check",
      sql`${table.category} IN (${toSqlList(toEnum(WebhookCategory))})`,
    ),
  ],
);

export const webhook = pgTable(
  "webhook",
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
    uniqueIndex("webhook_app_id_url_key").on(table.appId, table.url),
    check(
      "webhook_categories_nonempty_check",
      sql`cardinality(${table.categories}) > 0`,
    ),
    check(
      "webhook_categories_check",
      sql`${table.categories} <@ ARRAY[${toSqlList(toEnum(WebhookCategory))}]::text[]`,
    ),
    check("webhook_max_retries_check", sql`${table.maxRetries} >= 0`),
    check(
      "webhook_timeout_in_seconds_check",
      sql`${table.timeoutInSeconds} > 0`,
    ),
    check(
      "webhook_retry_interval_in_seconds_check",
      sql`${table.retryIntervalInSeconds} > 0`,
    ),
  ],
);

export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "restrict" }),
    attempt: integer("attempt").notNull(),
    error: text("error"),
    httpResponseCode: integer("http_response_code"),
    httpResponseHeaders: jsonb("http_response_headers"),
    httpResponseBody: text("http_response_body"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("webhook_delivery_event_id_webhook_id_attempt_key").on(
      table.eventId,
      table.webhookId,
      table.attempt,
    ),
    index("webhook_delivery_webhook_id_idx").on(table.webhookId),
    check("webhook_delivery_attempt_check", sql`${table.attempt} > 0`),
  ],
);

export const callbackRequest = pgTable(
  "callback_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerId: text("provider_id").notNull(),
    signingKey: text("signing_key"),
    input: jsonb("input").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("callback_request_app_id_idx").on(table.appId),
    uniqueIndex("callback_request_app_id_provider_provider_id_key").on(
      table.appId,
      table.provider,
      table.providerId,
    ),
  ],
);

export const token = pgTable(
  "token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    address: text("address").notNull(),
    symbol: text("symbol").notNull(),
    decimals: integer("decimals").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("token_chain_id_idx").on(table.chainId),
    unique("token_id_chain_id_key").on(table.id, table.chainId),
    check("token_decimals_check", sql`${table.decimals} BETWEEN 0 AND 255`),
    uniqueIndex("token_chain_id_address_key").on(table.chainId, table.address),
  ],
);

export const fee = pgTable(
  "fee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
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
    condition: jsonb("condition").notNull(),
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
    index("fee_app_id_idx").on(table.appId),
    index("fee_chain_id_idx").on(table.chainId),
    check("fee_value_check", sql`${table.value} >= 0`),
    check(
      "fee_min_max_check",
      sql`${table.minAmountToCharge} IS NULL OR ${table.maxAmountToCharge} IS NULL OR ${table.minAmountToCharge} <= ${table.maxAmountToCharge}`,
    ),
  ],
);

export const quote = pgTable(
  "quote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    chainId: uuid("chain_id")
      .notNull()
      .references(() => chain.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").references(() => customer.id, {
      onDelete: "set null",
    }),
    sourceTokenId: uuid("source_token_id").notNull(),
    targetTokenId: uuid("target_token_id").notNull(),
    sourceAmount: numeric("source_amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    targetAmount: numeric("target_amount", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    rate: numeric("rate", { precision: 38, scale: 18 }).notNull(),
    reference: text("reference"),
    meta: jsonb("meta"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("quote_app_id_idx").on(table.appId),
    index("quote_chain_id_idx").on(table.chainId),
    index("quote_customer_id_idx").on(table.customerId),
    index("quote_source_token_id_idx").on(table.sourceTokenId),
    index("quote_target_token_id_idx").on(table.targetTokenId),
    unique("quote_id_app_id_key").on(table.id, table.appId),
    uniqueIndex("quote_app_id_reference_key").on(table.appId, table.reference),
    check(
      "quote_amounts_check",
      sql`${table.sourceAmount} > 0 AND ${table.targetAmount} > 0 AND ${table.rate} > 0`,
    ),
    foreignKey({
      name: "quote_source_token_id_fk",
      columns: [table.sourceTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
    foreignKey({
      name: "quote_target_token_id_fk",
      columns: [table.targetTokenId, table.chainId],
      foreignColumns: [token.id, token.chainId],
    }).onDelete("restrict"),
  ],
);

export const quoteFee = pgTable(
  "quote_fee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    feeId: uuid("fee_id").references(() => fee.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    amount: numeric("value", {
      precision: 78,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    feeAddress: text("fee_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("quote_fee_quote_id_idx").on(table.quoteId),
    check("quote_fee_amount_check", sql`${table.amount} >= 0`),
  ],
);

export const transfer = pgTable(
  "transfer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id").notNull(),
    refundAddress: text("refund_address").notNull(),
    payinAddress: text("payin_address").notNull(),
    status: text("status", { enum: toEnum(TransferStatus) }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("transfer_app_id_idx").on(table.appId),
    uniqueIndex("transfer_quote_id_key").on(table.quoteId),
    uniqueIndex("transfer_payin_address_key").on(table.payinAddress),
    check(
      "transfer_status_check",
      sql`${table.status} IN (${toSqlList(toEnum(TransferStatus))})`,
    ),
    foreignKey({
      name: "transfer_quote_app_fk",
      columns: [table.quoteId, table.appId],
      foreignColumns: [quote.id, quote.appId],
    }).onDelete("restrict"),
  ],
);

export const transferTimeline = pgTable(
  "transfer_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfer.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").references(() => event.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("transfer_timeline_transfer_id_idx").on(table.transferId),
    index("transfer_timeline_event_id_idx").on(table.eventId),
  ],
);

export const appRelations = relations(app, ({ many }) => ({
  apiKeys: many(apiKey),
  customers: many(customer),
  events: many(event),
  webhooks: many(webhook),
  callbackRequests: many(callbackRequest),
  fees: many(fee),
  quotes: many(quote),
  transfers: many(transfer),
}));

export const apiKeyRelations = relations(apiKey, ({ one }) => ({
  app: one(app, {
    fields: [apiKey.appId],
    references: [app.id],
  }),
}));

export const customerRelations = relations(customer, ({ one, many }) => ({
  quotes: many(quote),
  app: one(app, {
    fields: [customer.appId],
    references: [app.id],
  }),
}));

export const eventRelations = relations(event, ({ one, many }) => ({
  deliveries: many(webhookDelivery),
  timelineEntries: many(transferTimeline),
  app: one(app, {
    fields: [event.appId],
    references: [app.id],
  }),
}));

export const webhookRelations = relations(webhook, ({ one, many }) => ({
  deliveries: many(webhookDelivery),
  app: one(app, {
    fields: [webhook.appId],
    references: [app.id],
  }),
}));

export const webhookDeliveryRelations = relations(
  webhookDelivery,
  ({ one }) => ({
    webhook: one(webhook, {
      fields: [webhookDelivery.webhookId],
      references: [webhook.id],
    }),
    event: one(event, {
      fields: [webhookDelivery.eventId],
      references: [event.id],
    }),
  }),
);

export const callbackRequestRelations = relations(
  callbackRequest,
  ({ one }) => ({
    app: one(app, {
      fields: [callbackRequest.appId],
      references: [app.id],
    }),
  }),
);

export const chainRelations = relations(chain, ({ one, many }) => ({
  config: one(chainConfig),
  tokens: many(token),
  allowTokens: many(chainAllowToken),
  denyTokens: many(chainDenyToken),
  fees: many(fee),
  quotes: many(quote),
}));

export const chainConfigRelations = relations(chainConfig, ({ one }) => ({
  chain: one(chain, {
    fields: [chainConfig.chainId],
    references: [chain.id],
  }),
  settlementToken: one(token, {
    fields: [chainConfig.settlementTokenId],
    references: [token.id],
  }),
}));

export const chainAllowTokenRelations = relations(
  chainAllowToken,
  ({ one }) => ({
    chain: one(chain, {
      fields: [chainAllowToken.chainId],
      references: [chain.id],
    }),
    token: one(token, {
      fields: [chainAllowToken.tokenId],
      references: [token.id],
    }),
  }),
);

export const chainDenyTokenRelations = relations(chainDenyToken, ({ one }) => ({
  chain: one(chain, {
    fields: [chainDenyToken.chainId],
    references: [chain.id],
  }),
  token: one(token, {
    fields: [chainDenyToken.tokenId],
    references: [token.id],
  }),
}));

export const tokenRelations = relations(token, ({ one, many }) => ({
  chain: one(chain, {
    fields: [token.chainId],
    references: [chain.id],
  }),
  settlementFor: many(chainConfig),
  allowedOn: many(chainAllowToken),
  deniedOn: many(chainDenyToken),
  quotesAsSource: many(quote, { relationName: "quote_source_token" }),
  quotesAsTarget: many(quote, { relationName: "quote_target_token" }),
}));

export const feeRelations = relations(fee, ({ one }) => ({
  app: one(app, {
    fields: [fee.appId],
    references: [app.id],
  }),
  chain: one(chain, {
    fields: [fee.chainId],
    references: [chain.id],
  }),
}));

export const quoteRelations = relations(quote, ({ one, many }) => ({
  app: one(app, {
    fields: [quote.appId],
    references: [app.id],
  }),
  chain: one(chain, {
    fields: [quote.chainId],
    references: [chain.id],
  }),
  customer: one(customer, {
    fields: [quote.customerId],
    references: [customer.id],
  }),
  sourceToken: one(token, {
    fields: [quote.sourceTokenId],
    references: [token.id],
    relationName: "quote_source_token",
  }),
  targetToken: one(token, {
    fields: [quote.targetTokenId],
    references: [token.id],
    relationName: "quote_target_token",
  }),
  quoteFees: many(quoteFee),
  transfer: one(transfer),
}));

export const quoteFeeRelations = relations(quoteFee, ({ one }) => ({
  quote: one(quote, {
    fields: [quoteFee.quoteId],
    references: [quote.id],
  }),
}));

export const transferRelations = relations(transfer, ({ one, many }) => ({
  timeline: many(transferTimeline),
  app: one(app, {
    fields: [transfer.appId],
    references: [app.id],
  }),
  quote: one(quote, {
    fields: [transfer.quoteId],
    references: [quote.id],
  }),
}));

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
