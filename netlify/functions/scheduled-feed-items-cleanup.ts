import type { Config } from "@netlify/functions";
import { and, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { feedItems } from "../../server/db/schema";
import { createDb } from "./db";

// feed_items shipped append-only: every synced item is inserted and never
// pruned, so the table grows without bound (far faster than
// processed_stripe_events, which already has scheduled-stripe-events-cleanup.ts).
// Ninety days keeps roughly a quarter of history — long enough that a returning
// reader still finds recent items — while bounding storage and query cost.
export const FEED_ITEM_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// This table shipped append-only, so the first prune faces the whole accrued
// backlog. Delete in bounded batches and cap the batches per run so a large
// backlog can never exceed the scheduled function's execution budget in one
// statement — an unfinished run just resumes on the next nightly invocation.
export const PRUNE_BATCH_SIZE = 5000;
export const MAX_PRUNE_BATCHES = 20;

type Database = ReturnType<typeof createDb>;

// A row is prunable only when it is older than the retention window AND the
// reader has not curated it. Starred and saved items are user-kept, so they are
// preserved regardless of age; createdAt (sync time) is the age reference
// because publishedAt is nullable and reflects the source, not our storage.
// feed_items_retention_created_at_idx is the partial index that matches this
// predicate exactly. starred defaults to false and is set on every insert, so
// eq(false) never leaves a genuinely starred row exposed.
function prunableFeedItemsFilter(cutoff: Date): SQL | undefined {
  return and(
    lt(feedItems.createdAt, cutoff),
    eq(feedItems.starred, false),
    isNull(feedItems.savedAt),
  );
}

async function deletePrunableBatch(
  db: Database,
  cutoff: Date,
): Promise<number> {
  const prunable = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(prunableFeedItemsFilter(cutoff))
    .limit(PRUNE_BATCH_SIZE);

  if (prunable.length === 0) {
    return 0;
  }

  await db.delete(feedItems).where(
    inArray(
      feedItems.id,
      prunable.map((row) => row.id),
    ),
  );

  return prunable.length;
}

async function pruneExpiredItems(
  cutoff: Date,
): Promise<{ deletedCount: number; complete: boolean }> {
  const db = createDb();
  let deletedCount = 0;

  for (let batch = 0; batch < MAX_PRUNE_BATCHES; batch += 1) {
    const removed = await deletePrunableBatch(db, cutoff);
    deletedCount += removed;

    if (removed < PRUNE_BATCH_SIZE) {
      return { deletedCount, complete: true };
    }
  }

  return { deletedCount, complete: false };
}

export default async function scheduledFeedItemsCleanup() {
  const cutoff = new Date(Date.now() - FEED_ITEM_RETENTION_MS);

  try {
    const { deletedCount, complete } = await pruneExpiredItems(cutoff);

    console.log(
      JSON.stringify({
        event: "scheduled-feed-items-cleanup.complete",
        cutoff: cutoff.toISOString(),
        deletedCount,
        complete,
      }),
    );

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "scheduled-feed-items-cleanup.error",
        cutoff: cutoff.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

export const config: Config = {
  // Run daily at 03:30 UTC — the retention window is measured in days, so a
  // once-a-day prune keeps the table bounded. Offset from the 03:00 stripe
  // cleanup so the two scheduled jobs do not contend for the DB at once.
  schedule: "30 3 * * *",
};
