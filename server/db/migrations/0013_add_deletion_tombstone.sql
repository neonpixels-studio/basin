CREATE TABLE "deletion_tombstones" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL
);
