// Honors the pricing page's downgrade promise (app/pages/pricing.vue):
// "Sources beyond the free limit are paused (not removed) ... reactivate them
// whenever you upgrade again." Called from the Stripe subscription webhook
// handler (server/utils/subscriptions.ts) on plan transitions. Isolated here so
// the pause/reactivate decisions are unit-testable without Stripe or a live DB.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { feeds } from "../db/schema";
import { FREE_PLAN_FEED_LIMIT } from "./planLimits";

export interface PauseResult {
  pausedCount: number;
}

export interface ReactivateResult {
  reactivatedCount: number;
}

// Deterministic rule for which sources stay active on a Pro→Free downgrade:
// the oldest FREE_PLAN_FEED_LIMIT sources (ordered by created_at ascending,
// then id ascending as a stable tiebreak for rows sharing a timestamp) remain
// active; every source after them is paused. Oldest-first means the user keeps
// the feeds they have followed longest. created_at is nullable, so NULLS FIRST
// treats any anomalous null-timestamp row as oldest — kept active rather than
// paused for a data quirk.
//
// Idempotent: only over-cap sources that are not already paused are written, so
// a redelivered downgrade event pauses nothing new. Sources already within the
// cap are never touched.
export async function pauseFeedsOverFreeLimit(
  userId: number,
): Promise<PauseResult> {
  const db = useDb();
  const userFeeds = await db
    .select({ id: feeds.id, paused: feeds.paused })
    .from(feeds)
    .where(eq(feeds.userId, userId))
    .orderBy(sql`${feeds.createdAt} asc nulls first`, asc(feeds.id));

  const overCapFeeds = userFeeds.slice(FREE_PLAN_FEED_LIMIT);
  const idsToPause = overCapFeeds
    .filter((feed) => !feed.paused)
    .map((feed) => feed.id);

  if (idsToPause.length === 0) {
    return { pausedCount: 0 };
  }

  // The paused=false guard makes the write safe against a concurrent pause
  // landing between the select and this update, and returning() reports the
  // rows actually changed rather than the intended count.
  const pausedRows = await db
    .update(feeds)
    .set({ paused: true, updatedAt: new Date() })
    .where(
      and(
        eq(feeds.userId, userId),
        eq(feeds.paused, false),
        inArray(feeds.id, idsToPause),
      ),
    )
    .returning({ id: feeds.id });

  return { pausedCount: pausedRows.length };
}

// Reactivates every paused source for the user. Called when an account moves
// back onto Pro (unlimited sources), completing the round trip promised on the
// pricing page. Idempotent: with no paused sources the update matches no rows.
export async function reactivateAllFeeds(
  userId: number,
): Promise<ReactivateResult> {
  const db = useDb();
  const reactivated = await db
    .update(feeds)
    .set({ paused: false, updatedAt: new Date() })
    .where(and(eq(feeds.userId, userId), eq(feeds.paused, true)))
    .returning({ id: feeds.id });

  return { reactivatedCount: reactivated.length };
}
