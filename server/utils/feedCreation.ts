// The single-feed add path: validates a URL is a real RSS/Atom feed (SSRF-safe
// fetch, size/redirect limits — see feedValidator.ts), detects rss vs podcast,
// and upserts it for the user (deduped on the feeds_user_id_url_idx unique
// index). Both POST /api/feeds and the OPML import route call this so the
// two entry points can never drift on validation or dedupe behavior.
import { feeds } from "../db/schema";
import {
  assertWithinFeedLimit,
  feedLimitExceededError,
  isFeedLimitDbError,
} from "./feedLimit";
import { fetchFeedBody, validateFeedContent } from "./feedValidator";
import { detectFeedSource } from "./feedSourceDetector";
import { CLEARED_SYNC_FAILURE_STATE } from "./feedSyncStatus";

const FEED_VALIDATION_TIMEOUT_MS = 10_000;

export type FeedSource = "rss" | "podcast";

export interface CreatedFeed {
  id: number;
  userId: number;
  url: string;
  title: string | null;
  source: string;
  sourceOverride: string | null;
  detectedSource: FeedSource;
}

async function fetchAndDetectSource(
  url: string,
  fetchImpl: typeof fetch,
): Promise<FeedSource> {
  const body = await fetchFeedBody(url, fetchImpl);
  return detectFeedSource(body);
}

async function validateWithTimeout(url: string): Promise<FeedSource> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    FEED_VALIDATION_TIMEOUT_MS,
  );

  const boundFetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => fetch(input, { ...init, signal: controller.signal });

  try {
    const isValid = await validateFeedContent(url, boundFetch as typeof fetch);

    if (!isValid) {
      throw createError({
        statusCode: 422,
        statusMessage: "URL does not point to a valid RSS or Atom feed",
      });
    }

    return await fetchAndDetectSource(url, boundFetch as typeof fetch);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validates and adds a single feed for a user, reusing the exact SSRF
 * validation and dedupe rules the single-feed add form uses. Throws an h3
 * error (with statusCode) on plan-cap (403), validation, or timeout failure —
 * callers that need to continue past a single rejected URL (e.g. OPML import)
 * must catch per call. The plan cap is checked first, before any network work.
 *
 * Note on re-adding an already-subscribed URL: the upsert re-detects the
 * source and, when `sourceOverride` isn't passed, resets any existing
 * `sourceOverride` back to null (see the `onConflictDoUpdate` below) — this
 * is pre-existing single-add behavior, not something OPML import
 * introduces, but OPML import calls this without a sourceOverride for every
 * entry, so re-importing a file that includes a feed the user manually
 * overrode (e.g. forced to "podcast") will reset it to auto-detected. See
 * feedCreation.test.ts for the locked-in behavior.
 */
export async function createFeedForUser(
  userId: number,
  url: string,
  sourceOverride?: FeedSource,
): Promise<CreatedFeed> {
  // Enforce the plan cap before any network work so a Free user over the limit
  // fails fast instead of paying for a feed fetch that would be rejected.
  await assertWithinFeedLimit(userId, url);

  let detectedSource: FeedSource;
  try {
    detectedSource = await validateWithTimeout(url);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) {
      throw createError({
        statusCode: 504,
        statusMessage: "Feed validation timed out",
      });
    }
    throw err;
  }

  const resolvedSource = sourceOverride ?? detectedSource;
  const feed = await upsertFeed(userId, url, resolvedSource, sourceOverride);
  return { ...feed, detectedSource } as CreatedFeed;
}

// Isolates the insert so the one place that can surface the DB cap trigger
// (migration 0011_enforce_source_cap.sql, rejecting a raced over-cap add) maps
// it back to the same 403 the app-level pre-check throws. Any other DB error
// propagates unchanged.
async function upsertFeed(
  userId: number,
  url: string,
  resolvedSource: FeedSource,
  sourceOverride?: FeedSource,
) {
  try {
    const [feed] = await useDb()
      .insert(feeds)
      .values({
        userId,
        url,
        source: resolvedSource,
        sourceOverride: sourceOverride ?? null,
      })
      .onConflictDoUpdate({
        target: [feeds.userId, feeds.url],
        // Re-adding an existing URL only reaches here after validateWithTimeout
        // has fetched and validated it, which proves the URL is reachable and
        // serving a valid feed again. Clear any recorded failure and retry
        // backoff so a repaired feed isn't left gated by nextRetryAt for up to
        // a day. Spread first so the source/override for this add win over the
        // shared defaults, not the other way round.
        set: {
          ...CLEARED_SYNC_FAILURE_STATE,
          source: resolvedSource,
          sourceOverride: sourceOverride ?? null,
        },
      })
      .returning();
    return feed;
  } catch (error) {
    if (isFeedLimitDbError(error)) {
      // The trigger only fires when the app-level pre-check raced and lost, or
      // the cap literals drifted between feedLimit.ts and migration 0011 — both
      // are server-side signals invisible in the returned 403, so log loudly.
      console.error(
        `Feed cap enforced at the DB layer for user ${userId}: the app-level pre-check raced and lost, or FREE_PLAN_FEED_LIMIT drifted from migration 0011.`,
        error,
      );
      throw feedLimitExceededError();
    }
    throw error;
  }
}
