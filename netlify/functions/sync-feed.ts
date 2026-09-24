import {
  asyncWorkloadFn,
  ErrorDoNotRetry,
  ErrorRetryAfterDelay,
} from "@netlify/async-workloads";
import type { AsyncWorkloadConfig } from "@netlify/async-workloads";
import { eq, and } from "drizzle-orm";
import { feeds, feedItems, integrations } from "../../server/db/schema";
import { parseRssFeed } from "../../server/utils/rssAdapter";
import { parsePodcastFeed } from "../../server/utils/podcastAdapter";
import {
  isTokenExpired,
  refreshAccessToken,
  fetchNewUploadsForChannel,
  TokenRefreshAuthError,
  YouTubeAuthError,
  YouTubeQuotaExceededError,
} from "../../server/utils/youtubeAdapter";
import {
  decryptNullableTokenTolerant,
  decryptTokenTolerant,
  encryptToken,
  TokenEncryptionKeyError,
} from "../../server/utils/crypto";
import {
  fetchNewBlueskyPosts,
  BLUESKY_SOURCE,
  DEFAULT_POST_FILTER_POLICY,
} from "../../server/utils/blueskyAdapter";
import type {
  BlueskyCredentials,
  BlueskySessionTokens,
} from "../../server/utils/blueskyAdapter";
import { createDb } from "./db";
import { initSentry, flushSentry } from "./sentry";
import {
  IntegrationAuthError,
  ServerConfigError,
  persistPermanentSyncFailure,
  persistSyncSuccess,
} from "./syncFailureTracking";
import { SYNC_FEED_EVENT_NAME, DEBOUNCE_WINDOW_MS } from "./types";
import type { SyncFeedEvent, SyncFeedEventData } from "./types";

// Supported source types — expand as new adapters are added.
const SUPPORTED_SOURCE_TYPES = new Set([
  "rss",
  "podcast",
  "youtube",
  BLUESKY_SOURCE,
]);

type FeedRecord = {
  id: number;
  url: string;
  title: string | null;
  source: string;
  lastFetched: Date | null;
  paused: boolean;
};

async function fetchFeedRecord(
  feedId: number,
  userId: number,
): Promise<FeedRecord | undefined> {
  const db = createDb();
  return db.query.feeds.findFirst({
    where: and(eq(feeds.id, feedId), eq(feeds.userId, userId)),
    columns: {
      id: true,
      url: true,
      title: true,
      source: true,
      lastFetched: true,
      paused: true,
    },
  });
}

// A missing/malformed TOKEN_ENCRYPTION_KEY is a server misconfiguration, not
// this user's fault — the same category as the missing Google OAuth client
// secret handled below (ServerConfigError), which persistPermanentSyncFailure
// deliberately skips persisting. A decrypt failure with a well-formed key
// (rotated/wrong key, corrupted ciphertext) means this connection's stored
// credentials are genuinely unusable, so that case is treated like a revoked
// token (IntegrationAuthError) and flagged "needs reconnect" instead of
// being retried forever. Either way, the underlying error is logged rather
// than embedded in the user-facing message, since that message is persisted
// verbatim to syncError and rendered as a tooltip (see the comment on
// syncYouTubeFeed's "No YouTube account is connected" message above).
function mapDecryptFailureToSyncError(provider: string, error: unknown): Error {
  if (error instanceof TokenEncryptionKeyError) {
    console.error(`${provider} token decryption misconfigured:`, error);
    return new ServerConfigError(
      `TOKEN_ENCRYPTION_KEY is missing or invalid; cannot decrypt ${provider} credentials.`,
    );
  }

  console.error(`${provider} token decryption failed:`, error);
  return new IntegrationAuthError(
    provider,
    `Your ${provider} connection could not be verified. Reconnect ${provider} in Settings.`,
  );
}

async function fetchBlueskyIntegration(userId: number) {
  const db = createDb();
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.provider, "bluesky"),
    ),
    columns: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenSecret: true,
      providerAccountId: true,
      providerUsername: true,
    },
  });

  if (!integration) {
    return integration;
  }

  try {
    return {
      ...integration,
      accessToken: decryptTokenTolerant(integration.accessToken),
      refreshToken: decryptNullableTokenTolerant(integration.refreshToken),
      tokenSecret: decryptNullableTokenTolerant(integration.tokenSecret),
    };
  } catch (error) {
    throw mapDecryptFailureToSyncError("bluesky", error);
  }
}

function isWithinDebounceWindow(lastFetched: Date | null): boolean {
  if (!lastFetched) {
    return false;
  }

  return Date.now() - lastFetched.getTime() < DEBOUNCE_WINDOW_MS;
}

async function upsertFeedItems(
  feedId: number,
  items: Awaited<ReturnType<typeof parseRssFeed>>,
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }

  const db = createDb();
  const result = await db
    .insert(feedItems)
    .values(items)
    .onConflictDoNothing({ target: [feedItems.feedId, feedItems.guid] })
    .returning({ id: feedItems.id });

  return result.length;
}

async function syncRssFeed(feedId: number, feedUrl: string): Promise<number> {
  const items = await parseRssFeed(feedUrl, feedId);
  return upsertFeedItems(feedId, items);
}

async function syncPodcastFeed(
  feedId: number,
  feedUrl: string,
): Promise<number> {
  const items = await parsePodcastFeed(feedUrl, feedId);
  return upsertFeedItems(feedId, items);
}

async function fetchYouTubeIntegration(userId: number) {
  const db = createDb();
  const integration = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, userId),
      eq(integrations.provider, "youtube"),
    ),
    columns: {
      id: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  });

  if (!integration) {
    return integration;
  }

  try {
    return {
      ...integration,
      accessToken: decryptTokenTolerant(integration.accessToken),
      refreshToken: decryptNullableTokenTolerant(integration.refreshToken),
    };
  } catch (error) {
    throw mapDecryptFailureToSyncError("youtube", error);
  }
}

async function persistRefreshedToken(
  integrationId: number,
  accessToken: string,
  expiresAt: Date,
): Promise<void> {
  const db = createDb();
  await db
    .update(integrations)
    .set({
      accessToken: encryptToken(accessToken),
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integrationId));
}

// Translates a token-endpoint auth failure (revoked/expired refresh token)
// into IntegrationAuthError so it is attributed to the connection, not the
// feed. Any other failure (network, 5xx) passes through unchanged so it
// still gets the normal transient-retry treatment.
async function refreshYouTubeToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
) {
  try {
    return await refreshAccessToken(refreshToken, clientId, clientSecret);
  } catch (error) {
    if (error instanceof TokenRefreshAuthError) {
      throw new IntegrationAuthError(
        "youtube",
        "YouTube authorization expired or was revoked. Re-connect your YouTube account.",
      );
    }
    throw error;
  }
}

async function resolveValidAccessToken(
  integration: NonNullable<Awaited<ReturnType<typeof fetchYouTubeIntegration>>>,
  // Bypasses the isTokenExpired check — used when the uploads API itself
  // just rejected the stored token with a 401 despite expiresAt saying it's
  // still live (see fetchYouTubeUploadsWithReauth): expiresAt can drift from
  // what Google actually honors (early invalidation, clock skew), so a live
  // 401 is stronger evidence than the stored timestamp.
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<string> {
  if (!forceRefresh && !isTokenExpired(integration.expiresAt)) {
    return integration.accessToken;
  }

  if (!integration.refreshToken) {
    throw new IntegrationAuthError(
      "youtube",
      "YouTube access token expired and no refresh token is stored. Re-connect your YouTube account.",
    );
  }

  const clientId = process.env.NUXT_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.NUXT_GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Missing server config, not a broken feed or user connection — the
    // token itself may be fine. persistPermanentSyncFailure skips
    // ServerConfigError entirely so this internal detail is never shown to
    // the user as a feed/integration failure.
    throw new ServerConfigError(
      "NUXT_GOOGLE_CLIENT_ID and NUXT_GOOGLE_CLIENT_SECRET must be set to refresh YouTube tokens.",
    );
  }

  const refreshed = await refreshYouTubeToken(
    integration.refreshToken,
    clientId,
    clientSecret,
  );

  await persistRefreshedToken(
    integration.id,
    refreshed.accessToken,
    refreshed.expiresAt,
  );

  return refreshed.accessToken;
}

// Translates a classified YouTube Data API failure (see youtubeAdapter.ts's
// resolveFailedYouTubeResponseError) into the workload's permanent-failure
// vocabulary, mirroring how refreshYouTubeToken above translates
// TokenRefreshAuthError: retrying a revoked token or an exhausted quota
// within the same sync can't succeed, so both skip runAdapterWithRetry's
// retry-with-delay path instead of burning attempts on it. Only the auth
// case is attributed to the connection (IntegrationAuthError) so
// SettingsConnections flags it for reconnect; a quota failure isn't the
// account's fault — reconnecting doesn't fix it — so it's a feed-only
// ErrorDoNotRetry instead, left to clear on its own once Google resets the
// quota (surfaced to the user via the feed's syncError, same as any other
// feed-level failure). Both branches skip runAdapterWithRetry's own
// "sync-feed.error" log (thrown as ErrorDoNotRetry, they never reach it), so
// each logs its own structured event here instead — otherwise a
// project-wide quota exhaustion, exactly the kind of incident worth paging
// on, would leave nothing but per-feed syncError rows to notice it by.
function mapYouTubeApiFailure(error: unknown, feedId: number): never {
  if (error instanceof YouTubeAuthError) {
    logSyncEvent(
      "sync-feed.youtube-auth-error",
      { feedId, error: error.message },
      "error",
    );
    throw new IntegrationAuthError(
      "youtube",
      "YouTube authorization expired or was revoked. Re-connect your YouTube account.",
    );
  }

  if (error instanceof YouTubeQuotaExceededError) {
    logSyncEvent(
      "sync-feed.youtube-quota-exceeded",
      { feedId, error: error.message },
      "error",
    );
    throw new ErrorDoNotRetry(
      "YouTube API quota exceeded. This feed will resume syncing automatically once quota resets.",
    );
  }

  throw error;
}

// True only for the narrow case a forced-refresh retry can actually fix: the
// uploads API rejected the token outright (401) and there's a refresh token
// to try. A 403 auth-like rejection (see AUTH_LIKE_403_REASONS in
// youtubeAdapter.ts) is a scope/account problem a refresh can't fix, and
// with no refresh token there's nothing to retry with — both escalate
// immediately instead.
function canRetryAfterForcedRefresh(
  error: unknown,
  integration: NonNullable<Awaited<ReturnType<typeof fetchYouTubeIntegration>>>,
): boolean {
  return (
    error instanceof YouTubeAuthError &&
    error.status === 401 &&
    Boolean(integration.refreshToken)
  );
}

// Isolates the fetchNewUploadsForChannel call so its failures can be
// reclassified (see mapYouTubeApiFailure) without that translation getting
// tangled into syncYouTubeFeed's own persistence steps. A 401 gets one
// forced-refresh-and-retry before being escalated: expiresAt can say the
// token is still live while Google has already invalidated it (early
// invalidation, clock skew), so a live 401 is stronger evidence than the
// stored timestamp, and only a refresh that itself fails (revoked refresh
// token) or a second 401 on the retried request proves the account
// genuinely needs reconnecting.
async function fetchYouTubeUploadsWithReauth(
  integration: NonNullable<Awaited<ReturnType<typeof fetchYouTubeIntegration>>>,
  accessToken: string,
  channelId: string,
  feedId: number,
  channelTitle: string,
  lastSyncedAt: Date | null,
): ReturnType<typeof fetchNewUploadsForChannel> {
  try {
    return await fetchNewUploadsForChannel(
      channelId,
      feedId,
      channelTitle,
      lastSyncedAt,
      accessToken,
    );
  } catch (error) {
    if (!canRetryAfterForcedRefresh(error, integration)) {
      mapYouTubeApiFailure(error, feedId);
    }

    const refreshedAccessToken = await resolveValidAccessToken(integration, {
      forceRefresh: true,
    });

    try {
      return await fetchNewUploadsForChannel(
        channelId,
        feedId,
        channelTitle,
        lastSyncedAt,
        refreshedAccessToken,
      );
    } catch (retryError) {
      mapYouTubeApiFailure(retryError, feedId);
    }
  }
}

async function syncYouTubeFeed(
  feedId: number,
  channelId: string,
  channelTitle: string | null,
  lastSyncedAt: Date | null,
  userId: number,
): Promise<number> {
  const integration = await fetchYouTubeIntegration(userId);

  if (!integration) {
    // No integration row exists yet, so there is nothing for
    // IntegrationAuthError to mark — this is a feed-level message only, and
    // must not embed the internal userId since it is persisted verbatim to
    // feeds.syncError and rendered as the SettingsFeeds tooltip.
    throw new ErrorDoNotRetry(
      "No YouTube account is connected. Connect YouTube in Settings.",
    );
  }

  // Resolve (and refresh if needed) the access token so it stays current —
  // fetchNewUploadsForChannel calls the authenticated playlistItems.list API
  // (not the old unauthenticated RSS feed), so a stale token fails the fetch
  // itself, not just later subscriptions-API calls.
  const accessToken = await resolveValidAccessToken(integration);

  const newItems = await fetchYouTubeUploadsWithReauth(
    integration,
    accessToken,
    channelId,
    feedId,
    channelTitle ?? channelId,
    lastSyncedAt,
  );

  return upsertFeedItems(feedId, newItems);
}

// Mirrors persistRefreshedToken (YouTube) for Bluesky: writes the fresh
// session JWTs back to the integrations row so the next sync resumes instead
// of re-authenticating with the app password. A defensive equality guard skips
// the write when neither JWT changed, so a caller that hands back identical
// tokens never triggers a needless update.
async function persistBlueskySession(
  integrationId: number,
  previous: BlueskySessionTokens,
  tokens: BlueskySessionTokens,
): Promise<void> {
  const tokensUnchanged =
    tokens.accessJwt === previous.accessJwt &&
    tokens.refreshJwt === previous.refreshJwt;

  if (tokensUnchanged) {
    return;
  }

  const db = createDb();
  await db
    .update(integrations)
    .set({
      accessToken: encryptToken(tokens.accessJwt),
      refreshToken: encryptToken(tokens.refreshJwt),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integrationId));
}

async function syncBlueskyFeed(
  feedId: number,
  userId: number,
  lastFetched: Date | null,
): Promise<number> {
  const integration = await fetchBlueskyIntegration(userId);

  if (!integration) {
    // No integration row exists yet — feed-level message only (see the
    // matching YouTube case above for why userId is never embedded here).
    throw new ErrorDoNotRetry(
      "No Bluesky account is connected. Connect Bluesky in Settings.",
    );
  }

  if (!integration.tokenSecret) {
    throw new IntegrationAuthError(
      "bluesky",
      "Your Bluesky app password is missing. Reconnect Bluesky in Settings.",
    );
  }

  if (!integration.providerUsername) {
    throw new IntegrationAuthError(
      "bluesky",
      "Your Bluesky username is missing. Reconnect Bluesky in Settings.",
    );
  }

  const credentials: BlueskyCredentials = {
    identifier: integration.providerUsername,
    appPassword: integration.tokenSecret,
    accessJwt: integration.accessToken ?? "",
    refreshJwt: integration.refreshToken ?? "",
    did: integration.providerAccountId ?? "",
  };

  const items = await fetchNewBlueskyPosts(
    credentials,
    feedId,
    lastFetched,
    DEFAULT_POST_FILTER_POLICY,
    // Use the adapter's default Bluesky I/O deps (undefined), and inject only
    // the storage sink so a refreshed session is mirrored back to this row.
    undefined,
    (tokens) =>
      persistBlueskySession(
        integration.id,
        {
          accessJwt: credentials.accessJwt,
          refreshJwt: credentials.refreshJwt,
        },
        tokens,
      ),
  );

  return upsertFeedItems(feedId, items);
}

async function runAdapter(
  feedId: number,
  userId: number,
  feed: FeedRecord,
): Promise<number> {
  if (feed.source === "podcast") {
    return syncPodcastFeed(feedId, feed.url);
  }

  if (feed.source === "youtube") {
    return syncYouTubeFeed(
      feed.id,
      feed.url,
      feed.title,
      feed.lastFetched,
      userId,
    );
  }

  if (feed.source === BLUESKY_SOURCE) {
    return syncBlueskyFeed(feedId, userId, feed.lastFetched);
  }

  return syncRssFeed(feedId, feed.url);
}

// Resolves the feed this event targets, throwing ErrorDoNotRetry for every
// permanent precondition failure (unsupported source, missing feed, source
// mismatch) so the caller only has to handle the success path.
async function resolveFeedForSync(
  eventData: SyncFeedEventData,
): Promise<FeedRecord> {
  const { userId, feedId, sourceType } = eventData;

  if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
    throw new ErrorDoNotRetry(
      `Unsupported sourceType: ${sourceType}. No adapter available.`,
    );
  }

  const feed = await fetchFeedRecord(feedId, userId);

  if (!feed) {
    throw new ErrorDoNotRetry(
      `Feed ${feedId} not found or does not belong to user ${userId}.`,
    );
  }

  if (feed.source !== sourceType) {
    throw new ErrorDoNotRetry(
      `Source mismatch for feed ${feedId}: event=${sourceType}, db=${feed.source}.`,
    );
  }

  return feed;
}

function logSyncEvent(
  event: string,
  fields: Record<string, unknown>,
  level: "log" | "error" = "log",
): void {
  console[level](JSON.stringify({ event, ...fields }));
}

// Runs the source-specific adapter, translating adapter failures into the
// workload's retry semantics: ErrorDoNotRetry propagates as-is, other errors
// retry with a delay until the attempt cap is hit.
async function runAdapterWithRetry(
  feed: FeedRecord,
  eventData: SyncFeedEventData,
  attempt: number,
): Promise<number> {
  const { feedId, userId, sourceType } = eventData;

  try {
    return await runAdapter(feedId, userId, feed);
  } catch (error) {
    if (error instanceof ErrorDoNotRetry) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    logSyncEvent(
      "sync-feed.error",
      { feedId, userId, attempt, error: message },
      "error",
    );

    if (attempt >= 4) {
      throw new ErrorDoNotRetry(
        `Feed ${feedId} sync failed after ${attempt} attempts: ${message}`,
      );
    }

    throw new ErrorRetryAfterDelay({
      message: `Feed sync failed for feed ${feedId} (${sourceType}): ${message}`,
      retryDelay: "30s",
      forceDelayTime: false,
    });
  }
}

async function processSyncFeedEvent(
  eventData: SyncFeedEventData,
  attempt: number,
): Promise<void> {
  const { userId, feedId, sourceType, mode } = eventData;

  const feed = await resolveFeedForSync(eventData);

  // Authoritative pause enforcement for every dispatcher (scheduled cron and
  // the on-demand "Refresh feeds" trigger alike): a source paused by a Pro→Free
  // downgrade (see server/utils/feedPause.ts) pulls no new content regardless of
  // how the sync was requested. Checked before the debounce so it short-circuits
  // both modes.
  if (feed.paused) {
    logSyncEvent("sync-feed.paused", { feedId, userId, mode });
    return;
  }

  if (mode === "scheduled" && isWithinDebounceWindow(feed.lastFetched)) {
    logSyncEvent("sync-feed.debounced", {
      feedId,
      userId,
      lastFetched: feed.lastFetched,
    });
    return;
  }

  logSyncEvent("sync-feed.start", {
    feedId,
    userId,
    sourceType,
    mode,
    attempt,
  });

  // Capture the sync-start time before reading any pages so the watermark never
  // advances past what was actually read. A post created after the first
  // timeline page but before completion would otherwise be skipped forever.
  const syncStartedAt = new Date();

  const itemsSynced = await runAdapterWithRetry(feed, eventData, attempt);

  await persistSyncSuccess(userId, feedId, sourceType, syncStartedAt);

  logSyncEvent("sync-feed.complete", { feedId, userId, itemsSynced });
}

// Persists a permanent failure without letting a persistence error replace
// the real one: the workload's retry/blocked semantics must always be driven
// by the sync failure itself, never by an incidental DB write failing while
// recording it.
async function recordPermanentFailure(
  userId: number,
  feedId: number,
  error: ErrorDoNotRetry,
): Promise<void> {
  // ServerConfigError is intentionally never persisted (see
  // syncFailureTracking.ts) — it's an operator problem, not a user-facing
  // one — but it still needs to reach the logs so someone notices.
  if (error instanceof ServerConfigError) {
    logSyncEvent(
      "sync-feed.server-config-error",
      { feedId, userId, error: error.message },
      "error",
    );
    return;
  }

  try {
    await persistPermanentSyncFailure(userId, feedId, error);
  } catch (persistError) {
    logSyncEvent(
      "sync-feed.persist-failure-error",
      {
        feedId,
        userId,
        originalError: error.message,
        persistError:
          persistError instanceof Error
            ? persistError.message
            : String(persistError),
      },
      "error",
    );
  }
}

// Runs the event and persists a permanent-failure record when one is thrown.
// Split out of the exported handler so that one stays a thin
// initSentry()/flushSentry() wrapper (see the handler's own comment for why
// the flush must run on every exit path, including this function re-throwing).
async function runSyncFeedEvent(event: SyncFeedEvent): Promise<void> {
  const { userId, feedId } = event.eventData;
  try {
    await processSyncFeedEvent(event.eventData, event.attempt);
  } catch (error) {
    // Permanent failures are the ones a user needs to act on (expired
    // token, missing integration, source mismatch, etc.) — persist them so
    // SettingsFeeds/SettingsConnections can surface a "needs attention"
    // indicator. Transient ErrorRetryAfterDelay failures are left alone;
    // they aren't yet a failure state worth showing the user.
    if (error instanceof ErrorDoNotRetry) {
      await recordPermanentFailure(userId, feedId, error);
    }

    throw error;
  }
}

export default asyncWorkloadFn<SyncFeedEvent>(async (event) => {
  try {
    // See netlify/functions/sentry.ts: this bundle never loads
    // sentry.server.config.ts, so blueskyAdapter.ts's Sentry calls need
    // their own client initialized in this runtime. Called inside the try
    // (not ahead of it): initSentry() calls loadEnv(), and before this
    // change env loading happened inside processSyncFeedEvent() (via
    // createDb()), where a failure lands in runSyncFeedEvent's own catch and
    // gets persisted through recordPermanentFailure(). Calling it outside
    // the try would let that same class of failure bypass both the failure
    // record and the flush below.
    initSentry();
    await runSyncFeedEvent(event);
  } finally {
    // Runs on every exit path (success, or runSyncFeedEvent re-throwing) —
    // see flushSentry()'s comment for why skipping this on any path would
    // silently drop that path's Sentry events.
    await flushSentry();
  }
});

export const asyncWorkloadConfig: AsyncWorkloadConfig<SyncFeedEvent> = {
  events: [SYNC_FEED_EVENT_NAME],
  maxRetries: 4,
  backoffSchedule: (attempt) => {
    if (attempt === 0) {
      return "30s";
    }
    if (attempt === 1) {
      return "2m";
    }
    if (attempt === 2) {
      return "10m";
    }
    return "30m";
  },
};
