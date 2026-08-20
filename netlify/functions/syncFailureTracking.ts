import { ErrorDoNotRetry } from "@netlify/async-workloads";
import { and, eq } from "drizzle-orm";
import { feeds, integrations } from "../../server/db/schema";
import { computeNextRetryAt } from "../../server/utils/feedSyncBackoff";
import { SYNC_STATUS } from "../../server/utils/syncStatus";
import { createDb } from "./db";

// Consecutive-failure count for a feed that has never failed (or has just
// succeeded). Kept as a named constant so the "reset on success" write reads
// intentionally rather than as a bare 0.
const NO_CONSECUTIVE_FAILURES = 0;

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

// Current consecutive-failure count for a feed. Scoped by (id, userId) —
// matching fetchFeedRecord's read scope and every other write here — so a
// feedId belonging to a different user than the event claims can never be
// read or written. A missing row (deleted between the sync attempt and this
// write) reads as zero failures, so the increment below still produces a sane
// first-failure backoff.
async function readConsecutiveFailures(
  feedId: number,
  userId: number,
): Promise<number> {
  const db = createDb();
  const feed = await db.query.feeds.findFirst({
    where: and(eq(feeds.id, feedId), eq(feeds.userId, userId)),
    columns: { consecutiveFailures: true },
  });

  return feed?.consecutiveFailures ?? NO_CONSECUTIVE_FAILURES;
}

// Records a permanent failure and advances the backoff: increments the
// consecutive-failure count and pushes nextRetryAt out by the schedule in
// feedSyncBackoff.ts. Advancing nextRetryAt is what stops the scheduler from
// re-emitting a sync for this feed on every 15-minute tick.
async function recordFeedSyncFailure(
  feedId: number,
  userId: number,
  message: string,
): Promise<void> {
  const consecutiveFailures =
    (await readConsecutiveFailures(feedId, userId)) + 1;
  const failedAt = new Date();

  const db = createDb();
  await db
    .update(feeds)
    .set({
      syncStatus: SYNC_STATUS.ERROR,
      syncError: message,
      syncFailedAt: failedAt,
      consecutiveFailures,
      nextRetryAt: computeNextRetryAt(consecutiveFailures, failedAt),
    })
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)));
}

async function recordFeedSyncSuccess(
  feedId: number,
  userId: number,
  syncedAt: Date,
): Promise<void> {
  const db = createDb();
  await db
    .update(feeds)
    .set({
      lastFetched: syncedAt,
      syncStatus: SYNC_STATUS.OK,
      syncError: null,
      syncFailedAt: null,
      consecutiveFailures: NO_CONSECUTIVE_FAILURES,
      nextRetryAt: null,
    })
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
