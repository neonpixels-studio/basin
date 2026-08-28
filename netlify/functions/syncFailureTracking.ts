import { ErrorDoNotRetry } from "@netlify/async-workloads";
import { and, eq, sql } from "drizzle-orm";
import { feeds, integrations } from "../../server/db/schema";
import {
  computeNextRetryAt,
  HEALTHY_SYNC_STATE,
} from "../../server/utils/feedSyncBackoff";
import { SYNC_STATUS } from "../../server/utils/syncStatus";
import { createDb } from "./db";

// Maps a feed's sourceType to the integration provider it depends on. RSS
// and podcast feeds have no backing integration, so they map to null and
// only the feed's own sync status is tracked for them. Used only on the
// success path — see IntegrationAuthError for how the failure path
// attributes a failure to a provider.
const SOURCE_TYPE_PROVIDER: Record<string, string | undefined> = {
  youtube: "youtube",
  bluesky: "bluesky",
};

export function providerForSourceType(sourceType: string): string | null {
  return SOURCE_TYPE_PROVIDER[sourceType] ?? null;
}

// Thrown instead of a plain ErrorDoNotRetry when a permanent failure is
// specifically attributable to the connected account (expired token with no
// refresh token, missing credentials) rather than the feed itself. This is
// the signal persistPermanentSyncFailure uses to decide whether the failure
// belongs on the integration too: a feed-only failure (source mismatch, feed
// deleted, retries exhausted on a network error) must never flag a healthy
// connection as needing reconnect.
export class IntegrationAuthError extends ErrorDoNotRetry {
  provider: string;

  constructor(provider: string, message: string) {
    super(message);
    this.name = "IntegrationAuthError";
    this.provider = provider;
  }
}

// Thrown for a permanent failure that is neither the feed's nor the
// connected account's fault — a server-side misconfiguration (e.g. a
// missing OAuth client secret). persistPermanentSyncFailure skips this
// entirely: it is not something the user did or can fix, so it must not be
// persisted as a feed/integration failure and shown to them as a "needs
// attention" tooltip. It still needs to reach an operator, so the caller is
// expected to log it before/instead of persisting.
export class ServerConfigError extends ErrorDoNotRetry {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigError";
  }
}

// Atomically bumps a feed's consecutive-failure count for a permanent failure,
// stamping the error status in the same statement. The increment is a single
// `consecutive_failures + 1` SQL expression, not a read-then-write: two
// concurrent failures serialize on the row and advance N -> N+1 -> N+2, where a
// read-then-write would let both read N and both write N+1, stalling the
// counter and the backoff derived from it. Scoped by (id, userId) like every
// write here, so one user's event can't touch another's feed. Returns the
// committed post-increment count, or null when no row matched — a feed deleted
// between the sync attempt and this write, for which doing nothing is correct.
async function incrementConsecutiveFailures(
  feedId: number,
  userId: number,
  message: string,
  failedAt: Date,
): Promise<number | null> {
  const db = createDb();
  const [updatedFeed] = await db
    .update(feeds)
    .set({
      syncStatus: SYNC_STATUS.ERROR,
      syncError: message,
      syncFailedAt: failedAt,
      consecutiveFailures: sql<number>`${feeds.consecutiveFailures} + 1`,
    })
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
    .returning({ consecutiveFailures: feeds.consecutiveFailures });

  return updatedFeed?.consecutiveFailures ?? null;
}

// Pushes nextRetryAt out by the backoff schedule so the scheduler stops
// re-emitting a sync for this feed on every 15-minute tick. It's a second
// statement because nextRetryAt derives from the post-increment count and
// computing it in SQL would duplicate the schedule feedSyncBackoff.ts owns and
// unit-tests; the neon-http driver has no interactive transactions to pair the
// two writes. The write is guarded by (syncFailedAt, consecutiveFailures) — the
// exact pair this failure just wrote — so a slow or stalled concurrent writer
// can't clobber a fresher nextRetryAt with its own stale one: the count
// distinguishes two failures that stamped the same millisecond, and the
// timestamp rules out an ABA where a success reset the count to zero and a
// fresh failure climbed back to the same value. Either predicate failing makes
// this a safe no-op — the row already holds the newer failure's backoff or a
// success's cleared state.
//
// Between the two statements (and after a hard crash before this one runs) the
// row is briefly counted with the prior failure's now-past nextRetryAt; a tick
// landing there re-syncs once and self-heals, and the error is never swallowed.
async function advanceNextRetryAt(
  feedId: number,
  userId: number,
  consecutiveFailures: number,
  failedAt: Date,
): Promise<void> {
  const db = createDb();
  await db
    .update(feeds)
    .set({ nextRetryAt: computeNextRetryAt(consecutiveFailures, failedAt) })
    .where(
      and(
        eq(feeds.id, feedId),
        eq(feeds.userId, userId),
        eq(feeds.syncFailedAt, failedAt),
        eq(feeds.consecutiveFailures, consecutiveFailures),
      ),
    );
}

// Records a permanent failure and advances the backoff. The atomic increment
// and the guarded nextRetryAt write are separate statements — see each helper.
async function recordFeedSyncFailure(
  feedId: number,
  userId: number,
  message: string,
): Promise<void> {
  const failedAt = new Date();
  const consecutiveFailures = await incrementConsecutiveFailures(
    feedId,
    userId,
    message,
    failedAt,
  );

  if (consecutiveFailures === null) {
    return;
  }

  await advanceNextRetryAt(feedId, userId, consecutiveFailures, failedAt);
}

async function recordFeedSyncSuccess(
  feedId: number,
  userId: number,
  syncedAt: Date,
): Promise<void> {
  const db = createDb();
  await db
    .update(feeds)
    .set({ ...HEALTHY_SYNC_STATE, lastFetched: syncedAt })
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)));
}

async function recordIntegrationSyncFailure(
  userId: number,
  provider: string,
  message: string,
): Promise<void> {
  const db = createDb();
  await db
    .update(integrations)
    .set({
      syncStatus: SYNC_STATUS.ERROR,
      syncError: message,
      syncFailedAt: new Date(),
    })
    .where(
      and(eq(integrations.userId, userId), eq(integrations.provider, provider)),
    );
}

async function recordIntegrationSyncSuccess(
  userId: number,
  provider: string,
): Promise<void> {
  const db = createDb();
  await db
    .update(integrations)
    .set({ syncStatus: SYNC_STATUS.OK, syncError: null, syncFailedAt: null })
    .where(
      and(eq(integrations.userId, userId), eq(integrations.provider, provider)),
    );
}

// Persists a permanent (ErrorDoNotRetry) sync failure on the feed, and —
// only when the failure is an IntegrationAuthError — on the connected
// account too, so SettingsConnections can surface a "needs reconnect"
// indicator. A feed-only failure (source mismatch, feed deleted, retries
// exhausted on a transient error) must not touch the integration: the
// connection itself may be perfectly healthy. A ServerConfigError touches
// neither — it is not the user's fault, so nothing is persisted for the
// user to see. Looking the integration up by (userId, provider) rather than
// an id means this still works even when the error was raised before an
// integration row was ever loaded (e.g. "no integration found" failures).
export async function persistPermanentSyncFailure(
  userId: number,
  feedId: number,
  error: ErrorDoNotRetry,
): Promise<void> {
  if (error instanceof ServerConfigError) {
    return;
  }

  await recordFeedSyncFailure(feedId, userId, error.message);

  if (!(error instanceof IntegrationAuthError)) {
    return;
  }

  await recordIntegrationSyncFailure(userId, error.provider, error.message);
}

// Marks a feed sync as successful and clears any previously-recorded failure
// on the feed and (when applicable) its backing integration.
export async function persistSyncSuccess(
  userId: number,
  feedId: number,
  sourceType: string,
  syncedAt: Date,
): Promise<void> {
  await recordFeedSyncSuccess(feedId, userId, syncedAt);

  const provider = providerForSourceType(sourceType);
  if (!provider) {
    return;
  }

  await recordIntegrationSyncSuccess(userId, provider);
}
