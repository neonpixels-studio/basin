// Bridges a newly connected YouTube or Bluesky account to the feeds table.
// server/api/auth/youtube/callback.get.ts and server/api/auth/bluesky.post.ts
// used to only ever write an integrations row, so a connected account never
// produced any content — the sync engine (netlify/functions/sync-feed.ts)
// only ever acts on feeds rows, never on integrations directly. Isolated here
// (rather than inline in the two connect handlers) so the connect-time
// feed-creation policy — one feed per subscribed YouTube channel, one feed
// for the whole Bluesky timeline, both capped by the same Free-plan limit a
// manual add respects — is unit-testable without a live DB.
//
// Every query here goes through the ambient useDb() (matching
// feedCreation.ts's own convention) rather than accepting an injected `db`
// parameter: neon-http opens a fresh stateless connection per query either
// way, so there is no pooling/transaction benefit to threading one through,
// and a single convention keeps every query in this file — including
// assertWithinFeedLimit's internal one — consistent.
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { feeds } from "../db/schema";
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

// Caps how many channels go into a single multi-row insert statement. Without
// chunking, an account with hundreds of subscriptions would cost one DB round
// trip per channel inside this synchronous OAuth callback, risking a function
// timeout before the redirect — see the "on a Free plan" perf tests and the
// PR description for the full reasoning. Chunking (rather than one statement
// for everything) also bounds how much work is discarded if a single
// statement fails for a reason unrelated to any specific row.
const YOUTUBE_FEED_INSERT_CHUNK_SIZE = 50;

export interface SkippedChannel {
  channelId: string;
  reason: string;
}

export interface CreateYouTubeFeedsResult {
  created: number;
  updated: number;
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

// Treats an empty title (YouTube returns "" for a deleted/private channel's
// snippet.title) the same as a missing one, so it never gets written to the
// title column — sync-feed.ts's `channelTitle ?? channelId` fallback only
// catches null/undefined, not "".
function normalizeTitle(title: string | null): string | null {
  return title || null;
}

// Shares the dedupe (feeds_user_id_url_idx) and backoff-reset semantics the
// manual add path uses (see upsertFeed in feedCreation.ts) — including
// translating a raced DB-trigger cap rejection (migration
// 0011_enforce_source_cap.sql) back into the same 403 — without pulling in
// that path's live URL validation/source detection. An integration-sourced
// feed's "url" is a channel id or profile link, not a fetchable RSS/Atom
// document, so there is nothing to validate or auto-detect.
//
// `title` is left out of the conflict `set` (rather than written as null)
// when there is none, so a reconnect never blanks out a title a previous
// connect already set on this row.
async function upsertIntegrationFeed(
  userId: number,
  source: string,
  url: string,
  title: string | null,
): Promise<void> {
  const normalizedTitle = normalizeTitle(title);
  const conflictTitle =
    normalizedTitle === null ? {} : { title: normalizedTitle };

  try {
    await useDb()
      .insert(feeds)
      .values({ userId, url, title: normalizedTitle, source })
      .onConflictDoUpdate({
        target: [feeds.userId, feeds.url],
        set: { ...UNGATED_SYNC_STATE, source, ...conflictTitle },
      });
  } catch (error) {
    if (isFeedLimitDbError(error)) {
      throw feedLimitExceededError();
    }
    throw error;
  }
}

// A subscriptions page boundary can shift mid-pagination and hand back the
// same channel twice; a batched multi-row insert would then fail outright
// ("ON CONFLICT DO UPDATE command cannot affect row a second time"), so
// dedupe before anything else touches the list.
function dedupeSubscriptionsByChannelId(
  subscriptions: YouTubeSubscription[],
): YouTubeSubscription[] {
  const byChannelId = new Map<string, YouTubeSubscription>();
  for (const subscription of subscriptions) {
    byChannelId.set(subscription.channelId, subscription);
  }
  return [...byChannelId.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// The per-item assertWithinFeedLimit check (three queries: plan, "already
// subscribed", current count) is right for the single-add path it was built
// for, but a YouTube account can carry hundreds of subscriptions — repeating
// it per channel inside this synchronous OAuth callback risks running the
// connect flow into a function timeout. Resolved once per connect instead: a
// paid plan skips straight to "unlimited" with a single query, and a Free
// plan gets one query for its current feed count plus one query for which of
// these specific channels it already follows (so a reconnect's already-owned
// channels don't eat into the remaining budget).
interface YouTubeFeedCapacity {
  existingChannelIds: Set<string>;
  remainingSlots: number;
}

async function resolveYouTubeFeedCapacity(
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
  const existingRows = await useDb().query.feeds.findMany({
    where: and(
      eq(feeds.userId, userId),
      eq(feeds.source, YOUTUBE_SOURCE),
      inArray(feeds.url, channelIds),
    ),
    columns: { url: true },
  });
  const existingChannelIds = new Set(existingRows.map((row) => row.url));

  const [countRow] = await useDb()
    .select({ value: count() })
    .from(feeds)
    .where(eq(feeds.userId, userId));
  const currentCount = countRow?.value ?? 0;
  const remainingSlots = Math.max(FREE_PLAN_FEED_LIMIT - currentCount, 0);

  return { existingChannelIds, remainingSlots };
}

// Splits subscriptions into what fits the remaining Free-plan budget and what
// doesn't, without any DB work — resolveYouTubeFeedCapacity already gathered
// everything needed to decide this synchronously.
function partitionByCapacity(
  subscriptions: YouTubeSubscription[],
  existingChannelIds: Set<string>,
  remainingSlots: number,
): { eligible: YouTubeSubscription[]; skipped: SkippedChannel[] } {
  const eligible: YouTubeSubscription[] = [];
  const skipped: SkippedChannel[] = [];
  let remaining = remainingSlots;

  for (const subscription of subscriptions) {
    const isExistingFeed = existingChannelIds.has(subscription.channelId);
    if (!isExistingFeed && remaining <= 0) {
      skipped.push({
        channelId: subscription.channelId,
        reason: reasonFromError(feedLimitExceededError()),
      });
      continue;
    }

    eligible.push(subscription);
    if (!isExistingFeed) {
      remaining -= 1;
    }
  }

  return { eligible, skipped };
}

// Attempts one channel in isolation — used both as the per-chunk fallback
// below and directly by tests. Returns null on success or a human-readable
// skip reason on failure, so the caller never has to catch/branch itself.
async function upsertYouTubeChannelFeed(
  userId: number,
  subscription: YouTubeSubscription,
): Promise<string | null> {
  try {
    await upsertIntegrationFeed(
      userId,
      YOUTUBE_SOURCE,
      subscription.channelId,
      subscription.title,
    );
    return null;
  } catch (error) {
    return reasonFromError(error);
  }
}

interface ChunkResult {
  succeededChannelIds: string[];
  skipped: SkippedChannel[];
}

// Falls back to one insert per channel when the batched statement for a
// chunk fails, so a single unrelated failure (a transient DB error, one row
// tripping the DB-trigger cap on a raced concurrent add) doesn't discard the
// rest of an otherwise-healthy chunk.
async function upsertYouTubeChunkPerRow(
  userId: number,
  subscriptions: YouTubeSubscription[],
): Promise<ChunkResult> {
  const succeededChannelIds: string[] = [];
  const skipped: SkippedChannel[] = [];

  for (const subscription of subscriptions) {
    const failureReason = await upsertYouTubeChannelFeed(userId, subscription);
    if (failureReason === null) {
      succeededChannelIds.push(subscription.channelId);
      continue;
    }
    skipped.push({ channelId: subscription.channelId, reason: failureReason });
  }

  return { succeededChannelIds, skipped };
}

async function upsertYouTubeChunk(
  userId: number,
  subscriptions: YouTubeSubscription[],
): Promise<ChunkResult> {
  const rows = subscriptions.map((subscription) => ({
    userId,
    url: subscription.channelId,
    title: normalizeTitle(subscription.title),
    source: YOUTUBE_SOURCE,
  }));

  try {
    await useDb()
      .insert(feeds)
      .values(rows)
      .onConflictDoUpdate({
        target: [feeds.userId, feeds.url],
        set: {
          ...UNGATED_SYNC_STATE,
          // A batched multi-row statement can't apply the single-row
          // "leave title alone when null" rule upsertIntegrationFeed uses
          // (see above) on a per-row basis, so a channel whose title just
          // went empty (deleted/private) can clobber a previously-known
          // title in this path. Traded deliberately for cutting connect-time
          // DB round trips from one per channel to one per chunk; a
          // reconnect re-fetches and re-fills the title once it's non-empty
          // again.
          source: sql`excluded.source`,
          title: sql`excluded.title`,
        },
      });
    return {
      succeededChannelIds: subscriptions.map(
        (subscription) => subscription.channelId,
      ),
      skipped: [],
    };
  } catch (error) {
    if (isFeedLimitDbError(error)) {
      // The whole batch raced a concurrent add and lost — not attributable
      // to any specific row, so surface the same skip reason for each rather
      // than guessing which ones would have fit.
      const reason = reasonFromError(feedLimitExceededError());
      return {
        succeededChannelIds: [],
        skipped: subscriptions.map((subscription) => ({
          channelId: subscription.channelId,
          reason,
        })),
      };
    }
    return upsertYouTubeChunkPerRow(userId, subscriptions);
  }
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
  userId: number,
  accessToken: string,
): Promise<CreateYouTubeFeedsResult> {
  const subscriptions = dedupeSubscriptionsByChannelId(
    await fetchYouTubeSubscriptions(accessToken),
  );

  if (subscriptions.length === 0) {
    return { created: 0, updated: 0, skipped: [] };
  }

  const { existingChannelIds, remainingSlots } =
    await resolveYouTubeFeedCapacity(userId, subscriptions);
  const { eligible, skipped } = partitionByCapacity(
    subscriptions,
    existingChannelIds,
    remainingSlots,
  );

  let created = 0;
  let updated = 0;

  for (const subscriptionChunk of chunk(
    eligible,
    YOUTUBE_FEED_INSERT_CHUNK_SIZE,
  )) {
    const chunkResult = await upsertYouTubeChunk(userId, subscriptionChunk);
    for (const channelId of chunkResult.succeededChannelIds) {
      if (existingChannelIds.has(channelId)) {
        updated += 1;
      } else {
        created += 1;
      }
    }
    skipped.push(...chunkResult.skipped);
  }

  return { created, updated, skipped };
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
  userId: number,
  handle: string,
): Promise<void> {
  const url = buildBlueskyProfileUrl(handle);
  const existingFeed = await useDb().query.feeds.findFirst({
    where: and(eq(feeds.userId, userId), eq(feeds.source, BLUESKY_SOURCE)),
    columns: { id: true, url: true },
  });

  if (existingFeed) {
    // A different url means either a renamed handle or a genuinely different
    // reconnected account — either way, the sync watermark (feeds.lastFetched)
    // must not carry over: sync-feed.ts feeds it straight to
    // fetchNewBlueskyPosts, and a stale watermark from the old identity would
    // silently skip everything in the new timeline older than it. Existing
    // feedItems are left alone rather than deleted: they dedupe on
    // (feedId, guid) against the new timeline, and deleting them outright
    // risks losing the user's starred/saved posts over what is, in the
    // common case, just a cosmetic handle rename.
    const isDifferentIdentity = existingFeed.url !== url;
    await useDb()
      .update(feeds)
      .set({
        url,
        title: handle,
        ...UNGATED_SYNC_STATE,
        ...(isDifferentIdentity ? { lastFetched: null } : {}),
      })
      .where(eq(feeds.id, existingFeed.id));
    return;
  }

  await assertWithinFeedLimit(userId, url);
  await upsertIntegrationFeed(userId, BLUESKY_SOURCE, url, handle);
}
