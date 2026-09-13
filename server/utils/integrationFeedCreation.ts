// Bridges a newly connected YouTube or Bluesky account to the feeds table.
// server/api/auth/youtube/callback.get.ts and server/api/auth/bluesky.post.ts
// used to only ever write an integrations row, so a connected account never
// produced any content — the sync engine (netlify/functions/sync-feed.ts)
// only ever acts on feeds rows, never on integrations directly. Isolated here
// (rather than inline in the two connect handlers) so the connect-time
// feed-creation policy — one feed per subscribed YouTube channel, one feed
// for the whole Bluesky timeline, both capped by the same Free-plan limit a
// manual add respects — is unit-testable without a live DB.
import { and, count, eq, inArray } from "drizzle-orm";
import { feeds } from "../db/schema";
import { useDb } from "./db";
import { BLUESKY_SOURCE } from "./blueskyAdapter";
import {
  assertWithinFeedLimit,
  feedLimitExceededError,
  isFeedLimitDbError,
} from "./feedLimit";
import { UNGATED_SYNC_STATE } from "./feedSyncBackoff";
import { FREE_PLAN_FEED_LIMIT } from "./planLimits";
import { getAccountPlan } from "./subscriptions";
import {
  fetchYouTubeSubscriptions,
  type YouTubeSubscription,
} from "./youtubeAdapter";

const YOUTUBE_SOURCE = "youtube";

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
  if (!(error instanceof Error)) {
    return "Failed to create feed";
  }

  const { statusMessage } = error as { statusMessage?: unknown };
  if (typeof statusMessage === "string") {
    return statusMessage;
  }

  return error.message;
}

function buildBlueskyProfileUrl(handle: string): string {
  return `${BLUESKY_PROFILE_URL_BASE}/${handle}`;
}

// Shares the dedupe (feeds_user_id_url_idx) and backoff-reset semantics the
// manual add path uses (see upsertFeed in feedCreation.ts) — including
// translating a raced DB-trigger cap rejection (migration
// 0011_enforce_source_cap.sql) back into the same 403 — without pulling in
// that path's live URL validation/source detection. An integration-sourced
// feed's "url" is a channel id or profile link, not a fetchable RSS/Atom
// document, so there is nothing to validate or auto-detect.
//
// `title` is omitted from the conflict `set` (rather than written as null)
// when the caller has none, so a reconnect never blanks out a title a
// previous connect (or the user) already set on this row.
async function upsertIntegrationFeed(
  db: Database,
  userId: number,
  source: string,
  url: string,
  title: string | null,
): Promise<void> {
  const conflictSet = title === null ? {} : { title };

  try {
    await db
      .insert(feeds)
      .values({ userId, url, title, source })
      .onConflictDoUpdate({
        target: [feeds.userId, feeds.url],
        set: { ...UNGATED_SYNC_STATE, source, ...conflictSet },
      });
  } catch (error) {
    if (isFeedLimitDbError(error)) {
      throw feedLimitExceededError();
    }
    throw error;
  }
}

// The per-item assertWithinFeedLimit check (three queries: plan, "already
// subscribed", current count) is right for the single-add path it was built
// for, but a YouTube account can carry hundreds of subscriptions — repeating
// it per channel inside this synchronous OAuth callback risks running the
// connect flow into a function timeout. Resolved once per connect instead:
// a paid plan skips straight to "unlimited" with a single query, and a Free
// plan gets one query for its current feed count plus one query for which of
// these specific channels it already follows (so a reconnect's already-owned
// channels don't eat into the remaining budget).
interface YouTubeFeedCapacity {
  existingChannelIds: Set<string>;
  remainingSlots: number;
}

async function resolveYouTubeFeedCapacity(
  db: Database,
  userId: number,
  subscriptions: YouTubeSubscription[],
): Promise<YouTubeFeedCapacity> {
  const { plan } = await getAccountPlan(userId);
  if (plan !== "free") {
    return {
      existingChannelIds: new Set(),
      remainingSlots: Number.POSITIVE_INFINITY,
    };
  }

  const channelIds = subscriptions.map(
    (subscription) => subscription.channelId,
  );
  const existingRows = await db.query.feeds.findMany({
    where: and(
      eq(feeds.userId, userId),
      eq(feeds.source, YOUTUBE_SOURCE),
      inArray(feeds.url, channelIds),
    ),
    columns: { url: true },
  });
  const existingChannelIds = new Set(existingRows.map((row) => row.url));

  const [countRow] = await db
    .select({ value: count() })
    .from(feeds)
    .where(eq(feeds.userId, userId));
  const currentCount = countRow?.value ?? 0;
  const remainingSlots = Math.max(FREE_PLAN_FEED_LIMIT - currentCount, 0);

  return { existingChannelIds, remainingSlots };
}

// One feed per subscribed channel, mirroring the youtube.readonly +
// subscriptions.list OAuth scope granted at connect time (see
// buildYouTubeAuthUrl in google.ts) — the whole point of that scope is to
// sync every channel the account follows, not a single hand-picked one.
//
// A channel that can't be added (e.g. a Free account already at its source
// cap) is skipped rather than aborting every other channel, since the other
// channels may still fit. The caller decides whether a failure to even list
// the subscriptions (the fetchYouTubeSubscriptions call itself throwing) is
// fatal to the connect flow — it isn't, by convention, since the account is
// already connected by the time this runs.
export async function createYouTubeFeedsForUser(
  db: Database,
  userId: number,
  accessToken: string,
): Promise<CreateYouTubeFeedsResult> {
  const subscriptions = await fetchYouTubeSubscriptions(accessToken);
  const skipped: SkippedChannel[] = [];

  if (subscriptions.length === 0) {
    return { created: 0, skipped };
  }

  const { existingChannelIds, remainingSlots } =
    await resolveYouTubeFeedCapacity(db, userId, subscriptions);
  let created = 0;
  let remaining = remainingSlots;

  for (const subscription of subscriptions) {
    const { channelId, title } = subscription;
    const isExistingFeed = existingChannelIds.has(channelId);

    if (!isExistingFeed && remaining <= 0) {
      skipped.push({
        channelId,
        reason: reasonFromError(feedLimitExceededError()),
      });
      continue;
    }

    try {
      await upsertIntegrationFeed(db, userId, YOUTUBE_SOURCE, channelId, title);
      created += 1;
      if (!isExistingFeed) {
        remaining -= 1;
      }
    } catch (error) {
      skipped.push({ channelId, reason: reasonFromError(error) });
    }
  }

  return { created, skipped };
}

// Bluesky syncs the connected account's own home timeline (see
// fetchNewBlueskyPosts), not a per-followed-account feed, so exactly one feed
// row ever represents the connection. A handle is not a stable key — the user
// can rename it on Bluesky, or disconnect and reconnect a different account —
// so a reconnect looks up the user's existing bluesky feed (there is never
// more than one) and updates it in place rather than keying the upsert on the
// current handle, which would leave a stale row behind under either change
// and double-sync the same timeline forever.
export async function createBlueskyFeedForUser(
  db: Database,
  userId: number,
  handle: string,
): Promise<void> {
  const url = buildBlueskyProfileUrl(handle);
  const existingFeed = await db.query.feeds.findFirst({
    where: and(eq(feeds.userId, userId), eq(feeds.source, BLUESKY_SOURCE)),
    columns: { id: true },
  });

  if (existingFeed) {
    await db
      .update(feeds)
      .set({ url, title: handle, ...UNGATED_SYNC_STATE })
      .where(eq(feeds.id, existingFeed.id));
    return;
  }

  await assertWithinFeedLimit(userId, url);
  await upsertIntegrationFeed(db, userId, BLUESKY_SOURCE, url, handle);
}
