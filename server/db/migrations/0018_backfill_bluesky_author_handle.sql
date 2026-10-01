-- Backfill author_handle for Bluesky posts synced before 0017. The handle is
-- the profile segment of the stored permalink
-- (https://bsky.app/profile/<handle>/post/<rkey>, see buildPermalinkFromUri).
-- Only rows still NULL are touched, and only on bluesky feeds.
UPDATE "feed_items"
SET "author_handle" = substring("feed_items"."url" from '^https://bsky\.app/profile/([^/]+)/post/')
FROM "feeds"
WHERE "feeds"."id" = "feed_items"."feed_id"
  AND "feeds"."source" = 'bluesky'
  AND "feed_items"."author_handle" IS NULL
  AND "feed_items"."url" ~ '^https://bsky\.app/profile/[^/]+/post/';
