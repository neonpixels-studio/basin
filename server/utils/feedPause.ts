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

export interface ReconcileResult {
  reactivatedIds: number[];
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

// Reconciles paused sources after a source is deleted. Paused rows count toward
// the add-gate cap (see feedLimit.ts countUserFeeds), so a downgraded Free
// account that deletes an active source frees an active slot while still holding
// paused, over-cap sources. Promote the oldest paused sources into the freed
// slots — extending the pricing-page promise that paused sources reactivate as
// room reappears, here by deletion rather than only by upgrading.
//
// paused=true is produced by exactly one path — pauseFeedsOverFreeLimit on a
// Free downgrade — and reactivateAllFeeds fully drains it on upgrade to Pro
// (unlimited, uncapped), so "active below the cap while paused rows exist"
// implies a Free account that just freed a slot. That invariant is why this
// needs no plan lookup (which would also import a cycle back through
// subscriptions.ts, the cycle planLimits.ts exists to avoid). If another
// producer of paused=true is ever added, gate this on the plan in the caller.
//
// Uses the same oldest-first ordering as pauseFeedsOverFreeLimit (created_at asc
// NULLS FIRST, then id asc) so the sources paused longest are restored first,
// mirroring pause/reactivate symmetry.
//
// Promotes up to the number of free slots rather than exactly one, so the result
// is self-healing: two deletes racing both read the same under-cap snapshot and
// the paused=true guard collapses their writes to a single promotion, leaving a
// slot short — the next delete's wider slot count fills it back to the cap.
// Idempotent: with active sources at the cap or no paused rows it writes nothing.
export async function reactivateOldestPausedFeedsUnderCap(
  userId: number,
): Promise<ReconcileResult> {
  const db = useDb();
  const userFeeds = await db
    .select({ id: feeds.id, paused: feeds.paused })
    .from(feeds)
    .where(eq(feeds.userId, userId))
    .orderBy(sql`${feeds.createdAt} asc nulls first`, asc(feeds.id));

  const freeSlots = FREE_PLAN_FEED_LIMIT - countActive(userFeeds);
  if (freeSlots <= 0) {
    return { reactivatedIds: [] };
  }

  const idsToReactivate = userFeeds
    .filter((feed) => feed.paused)
    .slice(0, freeSlots)
    .map((feed) => feed.id);
  if (idsToReactivate.length === 0) {
    return { reactivatedIds: [] };
  }

  const reactivated = await db
    .update(feeds)
    .set({ paused: false, updatedAt: new Date() })
    .where(
      and(
        inArray(feeds.id, idsToReactivate),
        eq(feeds.userId, userId),
        eq(feeds.paused, true),
      ),
    )
    .returning({ id: feeds.id });

  return { reactivatedIds: reactivated.map((feed) => feed.id) };
}

function countActive(userFeeds: { paused: boolean }[]): number {
  return userFeeds.filter((feed) => !feed.paused).length;
}
