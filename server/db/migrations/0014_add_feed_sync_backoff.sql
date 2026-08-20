ALTER TABLE "feeds" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "next_retry_at" timestamp;