import { and, eq } from "drizzle-orm";
import { feeds } from "../db/schema";
import { useDb } from "./db";
import { SYNC_STATUS } from "./syncStatus";

// The column values that represent a feed with no recorded sync failure and no
// active retry backoff. Shared by every "this feed is healthy again" write —
// a successful sync, an account reconnect, and re-adding a repaired feed URL —
// so they can't drift on which columns to clear. Clearing consecutiveFailures
// and nextRetryAt is what un-gates the feed: leaving them set keeps the
// scheduler from re-syncing a repaired feed for up to a day (nextRetryAt is
// pushed out exponentially, capped at 24h — see feedSyncBackoff.ts).
export const CLEARED_SYNC_FAILURE_STATE = {
  syncStatus: SYNC_STATUS.OK,
  syncError: null,
  syncFailedAt: null,
  consecutiveFailures: 0,
  nextRetryAt: null,
};

// Clears any recorded sync failure and retry backoff on every feed of the
// given source for this user. Called from the connect/reconnect handlers: a
// successful (re)connect proves the account works again, so a feed that
// previously failed against it (e.g. an expired YouTube token) shouldn't keep
// showing "Needs attention" — nor stay gated by its backoff window — until its
// next scheduled sync happens to run.
export async function clearFeedSyncFailures(
  db: ReturnType<typeof useDb>,
  userId: number,
  source: string,
): Promise<void> {
  await db
    .update(feeds)
    .set({ ...CLEARED_SYNC_FAILURE_STATE })
    .where(and(eq(feeds.userId, userId), eq(feeds.source, source)));
}
