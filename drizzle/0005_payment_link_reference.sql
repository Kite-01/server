ALTER TABLE "kite_payment_link" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "kite_payment_link" ADD COLUMN "meta" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "kite_payment_link_app_id_reference_key" ON "kite_payment_link" USING btree ("app_id","reference");