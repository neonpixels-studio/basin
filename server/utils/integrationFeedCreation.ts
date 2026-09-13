// Bridges a newly connected YouTube or Bluesky account to the feeds table.
// server/api/auth/youtube/callback.get.ts and server/api/auth/bluesky.post.ts
// used to only ever write an integrations row, so a connected account never
// produced any content — the sync engine (netlify/functions/sync-feed.ts)
// only ever acts on feeds rows, never on integrations directly. Isolated here
// (rather than inline in the two connect handlers) so the connect-time
// feed-creation policy — one feed per subscribed YouTube channel, one feed
// for the whole Bluesky timeline, both capped by the same Free-plan limit a
// manual add respects — is unit-testable without a live DB.
import { feeds } from "../db/schema";
import { useDb } from "./db";
import { assertWithinFeedLimit } from "./feedLimit";
import { UNGATED_SYNC_STATE } from "./feedSyncBackoff";
import { fetchSubscriptionChannelIds } from "./youtubeAdapter";

const YOUTUBE_SOURCE = "youtube";
const BLUESKY_SOURCE = "bluesky";

// Bluesky has no per-account "feed" resource to point a url column at — the
// synced content is the connected account's own home timeline (see
// fetchNewBlueskyPosts) — so the profile permalink stands in as a stable,
// human-meaningful identifier. Mirrors the domain buildPermalinkFromUri
// already uses for individual post links in blueskyAdapter.ts.
const BLUESKY_PROFILE_URL_BASE = "https://bsky.app/profile";

type Database = ReturnType<typeof useDb>;

export interface SkippedChannel {
  channelId: string;
  reason: string;
}

export interface CreateYouTubeFeedsResult {
  created: number;
  skipped: SkippedChannel[];
}

function reasonFromError(error: unknown): string {
  if (error instanceof Error && "statusMessage" in error) {
    const statusMessage = (error as { statusMessage?: unknown }).statusMessage;
    if (typeof statusMessage === "string") {
      return statusMessage;
    }
  }
  return error instanceof Error ? error.message : "Failed to create feed";
}

// Shares the dedupe (feeds_user_id_url_idx) and backoff-reset semantics the
// manual add path uses (see upsertFeed in feedCreation.ts), without pulling in
// that path's live URL validation/source detection — an integration-sourced
// feed's "url" is a channel id or profile link, not a fetchable RSS/Atom
// document, so there is nothing to validate or auto-detect.
async function upsertIntegrationFeed(
  db: Database,
  userId: number,
  source: string,
  url: string,
  title: string | null,
): Promise<void> {
  await db
    .insert(feeds)
    .values({ userId, url, title, source })
    .onConflictDoUpdate({
      target: [feeds.userId, feeds.url],
      set: { ...UNGATED_SYNC_STATE, source, title },
    });
}

// One feed per subscribed channel, mirroring the youtube.readonly +
// subscriptions.list OAuth scope granted at connect time (see
// buildYouTubeAuthUrl in google.ts) — the whole point of that scope is to
// sync every channel the account follows, not a single hand-picked one.
//
// A channel that can't be added (e.g. a Free account already at its source
// cap) is skipped rather than aborting every other channel, since the other
// channels may still fit. The caller decides whether a failure to even list
// the subscriptions (the fetchSubscriptionChannelIds call itself throwing) is
// fatal to the connect flow — it isn't, by convention, since the account is
// already connected by the time this runs.
export async function createYouTubeFeedsForUser(
  db: Database,
  userId: number,
  accessToken: string,
): Promise<CreateYouTubeFeedsResult> {
  const channelIds = await fetchSubscriptionChannelIds(accessToken);
  const skipped: SkippedChannel[] = [];
  let created = 0;

  for (const channelId of channelIds) {
    try {
      await assertWithinFeedLimit(userId, channelId);
      await upsertIntegrationFeed(db, userId, YOUTUBE_SOURCE, channelId, null);
      created += 1;
    } catch (error) {
      skipped.push({ channelId, reason: reasonFromError(error) });
    }
  }

  return { created, skipped };
}

// Bluesky syncs the connected account's own home timeline (see
// fetchNewBlueskyPosts), not a per-followed-account feed, so exactly one feed
// row represents the whole connection — never one per followed account.
export async function createBlueskyFeedForUser(
  db: Database,
  userId: number,
  handle: string,
): Promise<void> {
  const url = `${BLUESKY_PROFILE_URL_BASE}/${handle}`;
  await assertWithinFeedLimit(userId, url);
  await upsertIntegrationFeed(db, userId, BLUESKY_SOURCE, url, handle);
}
