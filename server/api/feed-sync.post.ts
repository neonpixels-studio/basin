import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { and, inArray, eq } from "drizzle-orm";
import { feeds } from "../db/schema";
import { SYNC_FEED_EVENT_NAME } from "../../netlify/functions/types";
import type { SyncFeedEventData } from "../../netlify/functions/types";

// Source types eligible for on-demand sync via async workloads.
const SYNCABLE_SOURCE_TYPES = ["rss", "podcast", "youtube", "bluesky"] as const;

// On-demand events run at elevated priority so users see results faster.
const ON_DEMAND_PRIORITY = 25;

async function fetchUserSyncableFeeds(userId: number) {
  return useDb().query.feeds.findMany({
    where: and(
      eq(feeds.userId, userId),
      inArray(feeds.source, [...SYNCABLE_SOURCE_TYPES]),
      // Don't queue paused sources (over the Free cap after a downgrade); the
      // worker also enforces this, but skipping them here avoids pointless
      // events — see netlify/functions/sync-feed.ts.
      eq(feeds.paused, false),
    ),
    columns: {
      id: true,
      source: true,
    },
  });
}

async function emitOnDemandEvent(
  client: AsyncWorkloadsClient,
  data: SyncFeedEventData,
): Promise<string> {
  const result = await client.send(SYNC_FEED_EVENT_NAME, {
    data,
    priority: ON_DEMAND_PRIORITY,
  });

  if (result.sendStatus !== "succeeded") {
    throw new Error(
      `Failed to emit sync-feed event for feed ${data.feedId}: status=${result.sendStatus}`,
    );
  }

  return result.eventId;
}

type EmitOutcome = { success: true; eventId: string } | { success: false };

// Mirrors the scheduled path's per-feed resilience: one feed's failed emit
// must not abort the rest, so failures are caught and reported, not thrown.
async function tryEmitOnDemandEvent(
  client: AsyncWorkloadsClient,
  userId: number,
  feed: { id: number; source: string },
): Promise<EmitOutcome> {
  try {
    const eventId = await emitOnDemandEvent(client, {
      userId,
      feedId: feed.id,
      sourceType: feed.source as SyncFeedEventData["sourceType"],
      mode: "on-demand",
    });

    return { success: true, eventId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "feed-sync.emit-failed",
        userId,
        feedId: feed.id,
        error: message,
      }),
    );

    return { success: false };
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const userFeeds = await fetchUserSyncableFeeds(user.id);

  if (userFeeds.length === 0) {
    return { queued: 0, failed: 0, eventIds: [] };
  }

  const client = new AsyncWorkloadsClient();
  const eventIds: string[] = [];
  let failed = 0;

  for (const feed of userFeeds) {
    const outcome = await tryEmitOnDemandEvent(client, user.id, feed);

    if (!outcome.success) {
      failed += 1;
      continue;
    }

    eventIds.push(outcome.eventId);
  }

  // Partial success returns counts; a total failure stays loud so the caller
  // never mistakes an emit outage for "nothing to sync".
  if (eventIds.length === 0 && failed > 0) {
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to queue feed sync",
    });
  }

  return { queued: eventIds.length, failed, eventIds };
});
