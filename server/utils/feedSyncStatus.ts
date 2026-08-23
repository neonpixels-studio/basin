import { and, eq } from "drizzle-orm";
import { feeds } from "../db/schema";
import { useDb } from "./db";
import { UNGATED_SYNC_STATE } from "./feedSyncBackoff";

// Clears the recorded sync failure and un-gates the retry backoff on every feed
// of the given source for this user. Called from the connect/reconnect
// handlers: a successful (re)connect proves the account works again, so a feed
// that previously failed against it (e.g. an expired YouTube token) shouldn't
// keep showing "Needs attention" — nor stay gated by its backoff window — until
// its next scheduled sync happens to run.
//
// Uses UNGATED_SYNC_STATE (not the full healthy reset): the reconnect proves
// the account works, but not that every feed under it does. Scoped to
// (userId, source), this also touches feeds whose failure was the feed's own
// fault (a dead channel URL, not the token). Preserving consecutiveFailures
// means such a feed gets one retry and, if still broken, jumps straight back to
// the cap rather than restarting the ramp — see UNGATED_SYNC_STATE.
export async function clearFeedSyncFailures(
  db: ReturnType<typeof useDb>,
  userId: number,
  source: string,
): Promise<void> {
  await db
    .update(feeds)
    .set({ ...UNGATED_SYNC_STATE })
    .where(and(eq(feeds.userId, userId), eq(feeds.source, source)));
}
