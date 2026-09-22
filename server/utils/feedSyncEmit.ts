import type { AsyncWorkloadsClient } from "@netlify/async-workloads";
import { SYNC_FEED_EVENT_NAME } from "../../netlify/functions/types";
import type { SyncFeedEventData } from "../../netlify/functions/types";

// On-demand events (the bulk "Refresh feeds" header action in
// server/api/feed-sync.post.ts, and the per-feed "Retry now" action in
// server/api/feeds/[id]/retry.post.ts) run at elevated priority so users see
// results faster than the scheduled cron sweep.
export const ON_DEMAND_SYNC_PRIORITY = 25;

// Isolates the AsyncWorkloadsClient call so every on-demand emit site shares
// one implementation instead of duplicating the client wiring and the
// sendStatus check. Throws when the send did not succeed; callers decide how
// to translate that into an HTTP response.
export async function emitOnDemandSyncEvent(
  client: AsyncWorkloadsClient,
  data: SyncFeedEventData,
): Promise<string> {
  const result = await client.send(SYNC_FEED_EVENT_NAME, {
    data,
    priority: ON_DEMAND_SYNC_PRIORITY,
  });

  if (result.sendStatus !== "succeeded") {
    throw new Error(
      `Failed to emit sync-feed event for feed ${data.feedId}: status=${result.sendStatus}`,
    );
  }

  return result.eventId;
}
