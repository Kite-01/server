ALTER TABLE "kite_token" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "kite_token" SET "listed" = true;