import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { and, eq } from "drizzle-orm";
import { feeds } from "../../../db/schema";
import { emitOnDemandSyncEvent } from "../../../utils/feedSyncEmit";
import { SYNC_STATUS } from "../../../utils/syncStatus";
import type { SyncFeedEventData } from "../../../../netlify/functions/types";

// Source types this route knows how to sync via async workloads — mirrors
// server/api/feed-sync.post.ts and netlify/functions/scheduled-feed-sync.ts.
const SYNCABLE_SOURCE_TYPES = new Set(["rss", "podcast", "youtube", "bluesky"]);

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

// Bounds this action to the state it exists for: a failing, unpaused,
// syncable feed. Re-checked server-side even though the "Retry now" control
// only renders on a "Needs attention" row — the client's view of the row can
// be stale by the time the request lands.
function assertRetryable(feed: RetryableFeed): void {
  if (!SYNCABLE_SOURCE_TYPES.has(feed.source)) {
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
  if (!feedId) {
    throw createError({ statusCode: 400, statusMessage: "Invalid feed ID" });
  }

  const feed = await fetchOwnedFeed(feedId, user.id);
  if (!feed) {
    throw createError({ statusCode: 404, statusMessage: "Feed not found" });
  }

  assertRetryable(feed);

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
