CREATE TABLE "kite_api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"label" text NOT NULL,
	"public_key" text NOT NULL,
	"scopes" text[] NOT NULL,
	"allowed_origins" text[],
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_api_key_scopes_check" CHECK ("kite_api_key"."scopes" <@ ARRAY['Apikey:Write', 'Apikey:Delete', 'Apikey:Read', 'App:Write', 'App:Delete', 'Customer:Read', 'Customer:Write', 'Customer:Delete', 'Fee:Read', 'Fee:Write', 'Fee:Delete', 'PaymentLink:Read', 'PaymentLink:Write', 'PaymentLink:Delete', 'quotes:read', 'quotes:write', 'Transfer:Read', 'Transfer:Write', 'Webhook:Read', 'Webhook:Write', 'Webhook:Delete', 'x402']::text[])
);
--> statement-breakpoint
CREATE TABLE "kite_api_nonce" (
	"key_id" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_api_nonce_key_id_nonce_pk" PRIMARY KEY("key_id","nonce")
);
--> statement-breakpoint
CREATE TABLE "kite_app" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"website_url" text,
	"terms_of_service_url" text,
	"privacy_policy_url" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kite_chain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"caip2_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kite_chain_config" (
	"chain_id" uuid PRIMARY KEY NOT NULL,
	"rpc_urls" text[],
	"slippage_bps" integer NOT NULL,
	"kite_factory_address" text NOT NULL,
	"usd_pegged_token_id" uuid NOT NULL,
	"settlement_token_id" uuid NOT NULL,
	"settlement_address" text,
	"onchain_notifier_providers" text[] NOT NULL,
	"gas_sponsor_providers" text[] NOT NULL,
	"max_gas_price" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kite_customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"traits" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_customer_id_app_id_key" UNIQUE("id","app_id")
);
--> statement-breakpoint
CREATE TABLE "kite_deposit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"chain_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"sender_address" text NOT NULL,
	"blockchain_hash" text NOT NULL,
	"log_index" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kite_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text,
	"app_id" uuid NOT NULL,
	"category" text NOT NULL,
	"previous_category_status" text,
	"current_category_status" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_event_category_check" CHECK ("kite_event"."category" IN ('Transfer', 'Deposit', 'Recovery', 'ExcessRefund'))
);
--> statement-breakpoint
CREATE TABLE "kite_fee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid,
	"chain_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	"min_amount_to_charge" numeric(78, 0),
	"max_amount_to_charge" numeric(78, 0),
	"condition" jsonb NOT NULL,
	"fee_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_fee_value_check" CHECK ("kite_fee"."value" >= 0),
	CONSTRAINT "kite_fee_min_max_check" CHECK ("kite_fee"."min_amount_to_charge" IS NULL OR "kite_fee"."max_amount_to_charge" IS NULL OR "kite_fee"."min_amount_to_charge" <= "kite_fee"."max_amount_to_charge")
);
--> statement-breakpoint
CREATE TABLE "kite_kv" (
	"key" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_kv_key_check" CHECK ("kite_kv"."key" IN ('AlchemyApiKey', 'AlchemyGasPolicyId', 'QuickNodeApiKey', 'QuickNodeEvmWalletFilter_WalletsListName', 'QuickNodeEvmWalletFilter_WebhookId', 'QuickNodeEvmContractEvents_WebhookId', 'QuickNodeEvmContractEvents_ContractsListName', 'QuickNodeEvmContractEvents_EventHashesListName', 'QuickNodeWebhookSecurityToken'))
);
--> statement-breakpoint
CREATE TABLE "kite_operator_forward" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_blockchain_hash" text NOT NULL,
	"kind" text NOT NULL,
	"token_id" uuid NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"recipient" text,
	"status" text NOT NULL,
	"reason" text,
	"call_id" text,
	"error" text,
	"blockchain_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_operator_forward_amount_check" CHECK ("kite_operator_forward"."amount" > 0),
	CONSTRAINT "kite_operator_forward_kind_check" CHECK ("kite_operator_forward"."kind" IN ('Refund', 'Excess', 'Recovery')),
	CONSTRAINT "kite_operator_forward_status_check" CHECK ("kite_operator_forward"."status" IN ('Pending', 'Submitted', 'Sent', 'Held', 'Failed'))
);
--> statement-breakpoint
CREATE TABLE "kite_payment_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"title" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"line_items" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kite_price_feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"address" text NOT NULL,
	"decimals" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_price_feed_base_currency_quote_currency_key" UNIQUE("base_currency","quote_currency")
);
--> statement-breakpoint
CREATE TABLE "kite_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"payment_link_id" uuid,
	"customer_id" uuid,
	"source_token_id" uuid NOT NULL,
	"target_token_id" uuid NOT NULL,
	"source_usd_amount" numeric(38, 18) NOT NULL,
	"source_amount" numeric(78, 0) NOT NULL,
	"target_amount" numeric(78, 0) NOT NULL,
	"target_usd_amount" numeric(38, 18) NOT NULL,
	"rate" numeric(38, 18) NOT NULL,
	"uniswap_pool_fee_tier" integer,
	"reference" text,
	"meta" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_quote_id_app_id_key" UNIQUE("id","app_id"),
	CONSTRAINT "kite_quote_amounts_check" CHECK ("kite_quote"."source_amount" > 0 AND "kite_quote"."target_amount" > 0 AND "kite_quote"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "kite_quote_fee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"fee_id" uuid,
	"label" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"fee_address" text NOT NULL,
	"blockchain_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_quote_fee_amount_check" CHECK ("kite_quote_fee"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "kite_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"icon" text,
	"supports_eip3009" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_token_id_chain_id_key" UNIQUE("id","chain_id"),
	CONSTRAINT "kite_token_decimals_check" CHECK ("kite_token"."decimals" BETWEEN 0 AND 255)
);
--> statement-breakpoint
CREATE TABLE "kite_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"settlement_recipient" text NOT NULL,
	"min_amount_out" numeric(78, 0) NOT NULL,
	"refund_address" text NOT NULL,
	"payin_address" text NOT NULL,
	"kite_transfer_input" jsonb NOT NULL,
	"status" text NOT NULL,
	"settlement_blockchain_hash" text,
	"refund_blockchain_hash" text,
	"x402_payer" text,
	"x402_authorization_nonce" text,
	"x402_authorization_hash" text,
	"x402_settlement_call_id" text,
	"x402_blockchain_hash" text,
	"x402_lease_expires_at" timestamp with time zone,
	"x402_settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_transfer_status_check" CHECK ("kite_transfer"."status" IN ('Created', 'AwaitingDeposit', 'DepositReceived', 'Processing', 'x402Settled', 'Cancelled', 'Refunded', 'Failed', 'Settled'))
);
--> statement-breakpoint
CREATE TABLE "kite_transfer_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kite_webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text NOT NULL,
	"categories" text[] NOT NULL,
	"signing_key" text NOT NULL,
	"signing_key_hint" text NOT NULL,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"retry_interval_in_seconds" integer DEFAULT 10 NOT NULL,
	"timeout_in_seconds" integer DEFAULT 60 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_webhook_categories_nonempty_check" CHECK (cardinality("kite_webhook"."categories") > 0),
	CONSTRAINT "kite_webhook_categories_check" CHECK ("kite_webhook"."categories" <@ ARRAY['Transfer', 'Deposit', 'Recovery', 'ExcessRefund']::text[]),
	CONSTRAINT "kite_webhook_max_retries_check" CHECK ("kite_webhook"."max_retries" >= 0),
	CONSTRAINT "kite_webhook_timeout_in_seconds_check" CHECK ("kite_webhook"."timeout_in_seconds" > 0),
	CONSTRAINT "kite_webhook_retry_interval_in_seconds_check" CHECK ("kite_webhook"."retry_interval_in_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "kite_webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"error" text,
	"http_response_code" integer,
	"http_response_headers" jsonb,
	"http_response_body" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_webhook_delivery_attempt_check" CHECK ("kite_webhook_delivery"."attempt" > 0)
);
--> statement-breakpoint
ALTER TABLE "kite_api_key" ADD CONSTRAINT "kite_api_key_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_chain_config" ADD CONSTRAINT "kite_chain_config_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_chain_config" ADD CONSTRAINT "kite_chain_config_settlement_token_fk" FOREIGN KEY ("settlement_token_id","chain_id") REFERENCES "public"."kite_token"("id","chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_chain_config" ADD CONSTRAINT "kite_chain_config_usd_pegged_token_fk" FOREIGN KEY ("usd_pegged_token_id","chain_id") REFERENCES "public"."kite_token"("id","chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_customer" ADD CONSTRAINT "kite_customer_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_deposit" ADD CONSTRAINT "kite_deposit_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_deposit" ADD CONSTRAINT "kite_deposit_token_chain_fk" FOREIGN KEY ("token_id","chain_id") REFERENCES "public"."kite_token"("id","chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_event" ADD CONSTRAINT "kite_event_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_fee" ADD CONSTRAINT "kite_fee_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_fee" ADD CONSTRAINT "kite_fee_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_operator_forward" ADD CONSTRAINT "kite_operator_forward_transfer_id_kite_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."kite_transfer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_operator_forward" ADD CONSTRAINT "kite_operator_forward_token_id_kite_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."kite_token"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_payment_link" ADD CONSTRAINT "kite_payment_link_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_price_feed" ADD CONSTRAINT "kite_price_feed_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote" ADD CONSTRAINT "kite_quote_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote" ADD CONSTRAINT "kite_quote_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote" ADD CONSTRAINT "kite_quote_payment_link_id_kite_payment_link_id_fk" FOREIGN KEY ("payment_link_id") REFERENCES "public"."kite_payment_link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote" ADD CONSTRAINT "kite_quote_source_token_id_fk" FOREIGN KEY ("source_token_id","chain_id") REFERENCES "public"."kite_token"("id","chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote" ADD CONSTRAINT "kite_quote_target_token_id_fk" FOREIGN KEY ("target_token_id","chain_id") REFERENCES "public"."kite_token"("id","chain_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote" ADD CONSTRAINT "kite_quote_customer_id_app_id_fk" FOREIGN KEY ("customer_id","app_id") REFERENCES "public"."kite_customer"("id","app_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote_fee" ADD CONSTRAINT "kite_quote_fee_quote_id_kite_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."kite_quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_quote_fee" ADD CONSTRAINT "kite_quote_fee_fee_id_kite_fee_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."kite_fee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_token" ADD CONSTRAINT "kite_token_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_transfer" ADD CONSTRAINT "kite_transfer_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_transfer" ADD CONSTRAINT "kite_transfer_quote_app_fk" FOREIGN KEY ("quote_id","app_id") REFERENCES "public"."kite_quote"("id","app_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_transfer_timeline" ADD CONSTRAINT "kite_transfer_timeline_transfer_id_kite_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."kite_transfer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_transfer_timeline" ADD CONSTRAINT "kite_transfer_timeline_event_id_kite_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."kite_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_webhook" ADD CONSTRAINT "kite_webhook_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_webhook_delivery" ADD CONSTRAINT "kite_webhook_delivery_webhook_id_kite_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."kite_webhook"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_webhook_delivery" ADD CONSTRAINT "kite_webhook_delivery_event_id_kite_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."kite_event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kite_api_key_app_id_idx" ON "kite_api_key" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "kite_api_nonce_created_at_idx" ON "kite_api_nonce" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_chain_caip2_id_active_key" ON "kite_chain" USING btree ("caip2_id") WHERE "kite_chain"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "kite_chain_config_settlement_token_id_idx" ON "kite_chain_config" USING btree ("settlement_token_id");--> statement-breakpoint
CREATE INDEX "kite_customer_created_at_idx" ON "kite_customer" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_customer_app_id_external_id_key" ON "kite_customer" USING btree ("app_id","external_id");--> statement-breakpoint
CREATE INDEX "kite_deposit_chain_id_idx" ON "kite_deposit" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "kite_deposit_token_id_idx" ON "kite_deposit" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "kite_deposit_address_idx" ON "kite_deposit" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_deposit_address_blockchain_hash_token_id_log_index_key" ON "kite_deposit" USING btree ("address","blockchain_hash","token_id","log_index");--> statement-breakpoint
CREATE INDEX "kite_event_app_id_idx" ON "kite_event" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "kite_event_created_at_idx" ON "kite_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_event_source_id_key" ON "kite_event" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "kite_fee_app_id_idx" ON "kite_fee" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "kite_fee_chain_id_idx" ON "kite_fee" USING btree ("chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_operator_forward_source_id_key" ON "kite_operator_forward" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "kite_operator_forward_transfer_id_idx" ON "kite_operator_forward" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "kite_operator_forward_token_id_idx" ON "kite_operator_forward" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "kite_operator_forward_status_idx" ON "kite_operator_forward" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kite_payment_link_app_id_idx" ON "kite_payment_link" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "kite_payment_link_currency_idx" ON "kite_payment_link" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "kite_price_feed_chain_id_idx" ON "kite_price_feed" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "kite_quote_app_id_idx" ON "kite_quote" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "kite_quote_created_at_idx" ON "kite_quote" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "kite_quote_chain_id_idx" ON "kite_quote" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "kite_quote_payment_link_id_idx" ON "kite_quote" USING btree ("payment_link_id");--> statement-breakpoint
CREATE INDEX "kite_quote_customer_id_idx" ON "kite_quote" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "kite_quote_source_token_id_idx" ON "kite_quote" USING btree ("source_token_id");--> statement-breakpoint
CREATE INDEX "kite_quote_target_token_id_idx" ON "kite_quote" USING btree ("target_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_quote_app_id_reference_key" ON "kite_quote" USING btree ("app_id","reference");--> statement-breakpoint
CREATE INDEX "kite_quote_fee_quote_id_idx" ON "kite_quote_fee" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "kite_token_chain_id_idx" ON "kite_token" USING btree ("chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_token_chain_id_address_key" ON "kite_token" USING btree ("chain_id","address") WHERE "kite_token"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "kite_transfer_app_id_idx" ON "kite_transfer" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "kite_transfer_created_at_idx" ON "kite_transfer" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "kite_transfer_status_idx" ON "kite_transfer" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_transfer_quote_id_key" ON "kite_transfer" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_transfer_payin_address_key" ON "kite_transfer" USING btree ("payin_address");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_transfer_x402_authorization_hash_key" ON "kite_transfer" USING btree ("x402_authorization_hash");--> statement-breakpoint
CREATE INDEX "kite_transfer_timeline_transfer_id_idx" ON "kite_transfer_timeline" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "kite_transfer_timeline_event_id_idx" ON "kite_transfer_timeline" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kite_webhook_app_id_url_key" ON "kite_webhook" USING btree ("app_id","url") WHERE "kite_webhook"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "kite_webhook_delivery_event_id_webhook_id_attempt_key" ON "kite_webhook_delivery" USING btree ("event_id","webhook_id","attempt");--> statement-breakpoint
CREATE INDEX "kite_webhook_delivery_webhook_id_idx" ON "kite_webhook_delivery" USING btree ("webhook_id");