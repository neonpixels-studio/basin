-- Backs the feed_items retention prune in
-- netlify/functions/scheduled-feed-items-cleanup.ts. The index is partial so it
-- covers only the rows the job can ever delete (old enough, not starred, not
-- saved), keeping the range scan cheap without indexing preserved rows.
CREATE INDEX "feed_items_retention_created_at_idx" ON "feed_items" USING btree ("created_at") WHERE "feed_items"."starred" = false and "feed_items"."saved_at" is null;
