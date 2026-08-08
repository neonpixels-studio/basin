// Enforces the Free plan's cap on *adding* new sources that the pricing page
// promises (app/pages/pricing.vue): Free accounts are limited to a fixed
// number of sources, any paid plan is unlimited. Isolated here so both
// feed-add entry points — POST /api/feeds and the OPML import route, which both
// funnel through createFeedForUser — share one plan/count check that can be
// unit-tested on its own.
//
// The complementary Pro→Free downgrade path (pausing sources already over the
// cap, which pricing.vue promises) lives in server/utils/feedPause.ts; both
// reuse FREE_PLAN_FEED_LIMIT from planLimits.ts.
import { count, eq } from "drizzle-orm";
import { feeds } from "../db/schema";
import { FREE_PLAN_FEED_LIMIT } from "./planLimits";
import { getAccountPlan } from "./subscriptions";

// The message and SQLSTATE the DB trigger (migration 0011_enforce_source_cap.sql)
// raises when a concurrent add slips past the app-level count and would breach
// the cap. Kept in sync with that migration; used to translate the raw DB error
// back into the same 403 the app-level guard throws. The SQLSTATE is checked
// alongside the message so the marker appearing in an unrelated error's SQL/
// params text (drizzle embeds the query and params in its wrapper message)
// can't be mistaken for a real cap rejection.
export const FEED_LIMIT_DB_ERROR_MARKER = "free_plan_feed_limit_exceeded";
export const FEED_LIMIT_SQLSTATE = "23514";

// The single 403 raised whenever a Free account would exceed the cap — thrown
// both by the app-level pre-check and when the DB trigger rejects a raced add,
// so the caller sees one consistent error regardless of which layer caught it.
export function feedLimitExceededError() {
  return createError({
    statusCode: 403,
    statusMessage: `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`,
  });
}

// True when an error thrown by a feed insert is the DB trigger rejecting an
// over-cap add (the race the app-level count can't catch). Isolates the
// driver-specific error shape so callers don't string-match inline. drizzle
// wraps the driver error in a DrizzleQueryError whose own message is the failed
// SQL — the raised marker sits on the wrapped Postgres error — so walk the
// `cause` chain rather than inspecting only the top-level message.
const MAX_ERROR_CAUSE_DEPTH = 10;

export function isFeedLimitDbError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      return false;
    }
    const { code } = current as { code?: string };
    if (
      code === FEED_LIMIT_SQLSTATE &&
      current.message.includes(FEED_LIMIT_DB_ERROR_MARKER)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

// Counts every source the user owns, including paused ones: a paused source
// (over-cap after a downgrade — see feedPause.ts) still occupies a slot toward
// the "up to 10 sources" cap, so a Free user must delete or upgrade before
// adding more. @todo Reconcile paused rows when a source is deleted so an
// account that drops back under the cap can un-pause a source without upgrading.
async function countUserFeeds(userId: number): Promise<number> {
  const [row] = await useDb()
    .select({ value: count() })
    .from(feeds)
    .where(eq(feeds.userId, userId));
  // Fail closed: a missing aggregate row means we can't prove the user is
  // under the cap, so refuse rather than default to 0 and wave them through.
  if (!row) {
    throw createError({
      statusCode: 500,
      statusMessage: "Could not determine current feed count",
    });
  }
  return row.value;
}

async function userAlreadyHasFeed(
  userId: number,
  url: string,
): Promise<boolean> {
  const existing = await useDb().query.feeds.findFirst({
    where: (feed, { and, eq: equals }) =>
      and(equals(feed.userId, userId), equals(feed.url, url)),
  });
  return Boolean(existing);
}

// Throws a 403 when a Free account tries to add a *new* source beyond the cap.
// Re-adding a URL the user already follows is an update (the add path upserts
// on user+url), not a new source, so it is never blocked. Only the Free plan
// is capped — any paid plan is unlimited and skips the count entirely.
//
// This is only a fast-path pre-check: the count and the eventual insert aren't
// one transaction (neon-http is stateless, no interactive transaction), so two
// simultaneous single-adds at exactly the limit could both pass here. The
// race-proof guarantee lives in the DB trigger (migration
// 0011_enforce_source_cap.sql), which serializes concurrent adds per user and
// rejects the over-cap one; createFeedForUser translates that rejection back
// into the same 403 (see isFeedLimitDbError). This pre-check keeps the common
// case fast — a clean 403 without paying for a feed fetch or a failed insert.
export async function assertWithinFeedLimit(
  userId: number,
  url: string,
): Promise<void> {
  const { plan } = await getAccountPlan(userId);
  if (plan !== "free") {
    return;
  }

  const alreadySubscribed = await userAlreadyHasFeed(userId, url);
  if (alreadySubscribed) {
    return;
  }

  const currentCount = await countUserFeeds(userId);
  if (currentCount < FREE_PLAN_FEED_LIMIT) {
    return;
  }

  throw feedLimitExceededError();
}
