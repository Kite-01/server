CREATE TABLE "kite_app_chain" (
	"app_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kite_app_chain_app_id_chain_id_pk" PRIMARY KEY("app_id","chain_id")
);
--> statement-breakpoint
CREATE TABLE "kite_payout" (
	"transfer_id" uuid PRIMARY KEY NOT NULL,
	"deposit_address" text NOT NULL,
	"destination_asset" text NOT NULL,
	"destination_symbol" text NOT NULL,
	"destination_chain" text NOT NULL,
	"recipient" text NOT NULL,
	"refund_to" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"quote" jsonb NOT NULL,
	"amount_out" numeric(78, 0),
	"refunded_amount" numeric(78, 0),
	"blockchain_hash" text,
	"explorer_url" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kite_transfer_timeline" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kite_app" ADD COLUMN "payout_asset" text;--> statement-breakpoint
ALTER TABLE "kite_app" ADD COLUMN "payout_address" text;--> statement-breakpoint
ALTER TABLE "kite_token" ADD COLUMN "near_intents_asset_id" text;--> statement-breakpoint
ALTER TABLE "kite_app_chain" ADD CONSTRAINT "kite_app_chain_app_id_kite_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."kite_app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_app_chain" ADD CONSTRAINT "kite_app_chain_chain_id_kite_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."kite_chain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kite_payout" ADD CONSTRAINT "kite_payout_transfer_id_kite_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."kite_transfer"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kite_app_chain_chain_id_idx" ON "kite_app_chain" USING btree ("chain_id");