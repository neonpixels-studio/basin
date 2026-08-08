import type { Config } from "@netlify/functions";
import { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { and, eq, lt, or, isNull, inArray } from "drizzle-orm";
import { feeds } from "../../server/db/schema";
import { createDb } from "./db";
import { SYNC_FEED_EVENT_NAME, DEBOUNCE_WINDOW_MS } from "./types";
import type { SyncFeedEventData } from "./types";

type DueFeed = { id: number; userId: number; source: string };

// Source types that this scheduler knows how to sync via async workloads.
const SYNCABLE_SOURCE_TYPES = ["rss", "podcast", "youtube", "bluesky"] as const;

async function fetchDueFeeds(): Promise<DueFeed[]> {
  const db = createDb();
  const cutoffTime = new Date(Date.now() - DEBOUNCE_WINDOW_MS);

  return db.query.feeds.findMany({
    where: and(
      inArray(feeds.source, [...SYNCABLE_SOURCE_TYPES]),
      or(isNull(feeds.lastFetched), lt(feeds.lastFetched, cutoffTime)),
      // Paused sources (over the Free cap after a downgrade) stop pulling new
      // content until the account upgrades again — see server/utils/feedPause.ts.
      eq(feeds.paused, false),
    ),
    columns: {
      id: true,
      userId: true,
      source: true,
    },
  });
}

async function emitSyncEvent(
  client: AsyncWorkloadsClient,
  data: SyncFeedEventData,
): Promise<string> {
  const result = await client.send(SYNC_FEED_EVENT_NAME, { data });
  if (result.sendStatus !== "succeeded") {
    throw new Error(
      `Failed to emit sync-feed event for feed ${data.feedId}: status=${result.sendStatus}`,
    );
  }
  return result.eventId;
}

async function emitFeedSyncEvent(
  client: AsyncWorkloadsClient,
  feed: DueFeed,
): Promise<{ success: boolean }> {
  try {
    const eventId = await emitSyncEvent(client, {
      userId: feed.userId,
      feedId: feed.id,
      sourceType: feed.source as SyncFeedEventData["sourceType"],
      mode: "scheduled",
    });

    console.log(
      JSON.stringify({
        event: "scheduled-feed-sync.emitted",
        feedId: feed.id,
        eventId,
      }),
    );

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "scheduled-feed-sync.emit-failed",
        feedId: feed.id,
        error: message,
      }),
    );
    return { success: false };
  }
}

async function emitAllSyncEvents(
  client: AsyncWorkloadsClient,
  dueFeeds: DueFeed[],
): Promise<{ emitted: number; failed: number }> {
  const results: Array<{ success: boolean }> = [];
  const BATCH_SIZE = 25;

  for (let index = 0; index < dueFeeds.length; index += BATCH_SIZE) {
    const batch = dueFeeds.slice(index, index + BATCH_SIZE);
    results.push(
      ...(await Promise.all(
        batch.map((feed) => emitFeedSyncEvent(client, feed)),
      )),
    );
  }

  const emitted = results.filter((result) => result.success).length;
  const failed = results.filter((result) => !result.success).length;

  return { emitted, failed };
}

export default async function scheduledFeedSync() {
  const dueFeeds = await fetchDueFeeds();

  if (dueFeeds.length === 0) {
    console.log(JSON.stringify({ event: "scheduled-feed-sync.no-due-feeds" }));
    return new Response(null, { status: 200 });
  }

  console.log(
    JSON.stringify({
      event: "scheduled-feed-sync.start",
      dueCount: dueFeeds.length,
    }),
  );

  const client = new AsyncWorkloadsClient();
  const { emitted, failed } = await emitAllSyncEvents(client, dueFeeds);

  console.log(
    JSON.stringify({ event: "scheduled-feed-sync.complete", emitted, failed }),
  );

  return new Response(null, { status: 200 });
}

export const config: Config = {
  // Run every 15 minutes
  schedule: "*/15 * * * *",
};
