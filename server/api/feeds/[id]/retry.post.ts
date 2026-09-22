import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { and, eq } from "drizzle-orm";
import { feeds } from "../../../db/schema";
import {
  emitOnDemandSyncEvent,
  SYNCABLE_SOURCE_TYPES,
} from "../../../utils/feedSyncEmit";
import { checkRateLimit } from "../../../utils/rateLimit";
import type { RateLimitStore } from "../../../utils/rateLimit";
import { SYNC_STATUS } from "../../../utils/syncStatus";
import { DEBOUNCE_WINDOW_MS } from "../../../../netlify/functions/types";
import type { SyncFeedEventData } from "../../../../netlify/functions/types";

// This route deliberately skips the scheduler's nextRetryAt/backoff gate (see
// the comment on eventData below) — that's the whole point of "Retry now".
// But nothing else stands between a click and a fresh priority-25 workload
// event, so a script or a user re-clicking after the client's poll window
// gives up (app/composables/useFeeds.ts's RETRY_POLL_*) could otherwise queue
// a stream of events for the same feed. This reuses the fixed-window
// primitive server/utils/rateLimit.ts already isolates and tests, with its
// own store — a per-feed retry cooldown is a different concern from that
// module's per-route/IP abuse limiting, so it gets its own Map rather than
// sharing rateLimitStore. One retry per feed per DEBOUNCE_WINDOW_MS, the same
// window the scheduled sweep debounces on.
//
// SAME SERVERLESS TRADEOFF AS rateLimit.ts: this Map is per function
// instance, so it blunts a single warm instance being hammered rather than
// giving a hard global guarantee — a caller spread across several cold-started
// instances could still exceed one retry per window for a feed. Acceptable
// for the same reason rateLimit.ts accepts it (no shared store in basin's
// infra today); a hard guarantee would need a DB column or shared cache.
//
// Exported (mirroring rateLimitStore) so tests can clear it between cases —
// this module-level store otherwise persists state across every test in a
// file that reuses the same feed id.
export const retryCooldownStore: RateLimitStore = new Map();
const RETRY_COOLDOWN_LIMIT = 1;

function retryCooldownKey(feedId: number): string {
  return `feed-retry:${feedId}`;
}

type RetryableFeed = {
  id: number;
  source: string;
  syncStatus: string;
  paused: boolean;
};

async function fetchOwnedFeed(
  feedId: number,
  userId: number,
): Promise<RetryableFeed | undefined> {
  return useDb().query.feeds.findFirst({
    where: and(eq(feeds.id, feedId), eq(feeds.userId, userId)),
    columns: { id: true, source: true, syncStatus: true, paused: true },
  });
}

function assertNotOnCooldown(feedId: number): void {
  const result = checkRateLimit(
    retryCooldownStore,
    retryCooldownKey(feedId),
    RETRY_COOLDOWN_LIMIT,
    Date.now(),
    DEBOUNCE_WINDOW_MS,
  );

  if (!result.allowed) {
    throw createError({
      statusCode: 429,
      statusMessage: "A retry for this feed was already queued recently",
    });
  }
}

// Bounds this action to the state it exists for: a failing, unpaused,
// syncable feed. Re-checked server-side even though the "Retry now" control
// only renders on a "Needs attention" row — the client's view of the row can
// be stale by the time the request lands.
function assertRetryable(feed: RetryableFeed): void {
  if (!(SYNCABLE_SOURCE_TYPES as readonly string[]).includes(feed.source)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Feed source "${feed.source}" cannot be synced`,
    });
  }

  if (feed.paused) {
    throw createError({
      statusCode: 409,
      statusMessage: "Feed is paused and cannot be retried",
    });
  }

  if (feed.syncStatus !== SYNC_STATUS.ERROR) {
    throw createError({
      statusCode: 409,
      statusMessage: "Feed is not in a failing state",
    });
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const feedId = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(feedId) || feedId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid feed ID" });
  }

  const feed = await fetchOwnedFeed(feedId, user.id);
  if (!feed) {
    throw createError({ statusCode: 404, statusMessage: "Feed not found" });
  }

  assertRetryable(feed);
  // Checked after ownership/state validation so a rejected attempt (wrong
  // state, not owned) never consumes the cooldown slot — only a request that
  // actually reaches the emit step counts against it.
  assertNotOnCooldown(feedId);

  // Emitted directly against this one feed rather than routed through the
  // scheduler's fetchDueFeeds query (netlify/functions/scheduled-feed-sync.ts),
  // which is what gates a feed on its backoff window (feeds.nextRetryAt — see
  // server/utils/feedSyncBackoff.ts). The workload itself
  // (netlify/functions/sync-feed.ts) never reads nextRetryAt — only the
  // scheduler's query does — so an on-demand event for this feed always runs
  // regardless of how far its backoff has advanced. nextRetryAt is left
  // untouched here; a fresh failure still resumes the existing exponential
  // schedule instead of resetting it, exactly like every other retry attempt.
  const eventData: SyncFeedEventData = {
    userId: user.id,
    feedId: feed.id,
    sourceType: feed.source as SyncFeedEventData["sourceType"],
    mode: "on-demand",
  };

  try {
    const client = new AsyncWorkloadsClient();
    const eventId = await emitOnDemandSyncEvent(client, eventData);
    return { queued: true, eventId };
  } catch (error) {
    // Nothing was actually queued, so the cooldown slot assertNotOnCooldown
    // just claimed must not stand — otherwise a transient emit failure would
    // both fail this request AND 429 the user's very next (otherwise valid)
    // attempt with a message claiming a retry is already in flight.
    retryCooldownStore.delete(retryCooldownKey(feedId));
    console.error(
      JSON.stringify({
        event: "feed-retry.emit-failed",
        userId: user.id,
        feedId: feed.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to queue feed retry",
    });
  }
});
