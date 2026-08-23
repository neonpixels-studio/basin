// Backoff schedule for feeds whose sync hits a permanent (non-retryable)
// failure. Without this, a feed with a revoked token, dead URL, or 404 stays
// perpetually "due" and re-runs the full adapter on every 15-minute scheduler
// tick (netlify/functions/scheduled-feed-sync.ts), burning async-workload
// invocations and hammering dead origins. Isolated here so the retry-timing
// decision is unit-testable without a live DB or scheduler.
//
// The schedule is exponential with a cap: each consecutive failure roughly
// doubles the wait, up to MAX_BACKOFF_MS. A successful sync resets the
// consecutive-failure count (see persistSyncSuccess), so the delay collapses
// back to nothing.

// Consecutive-failure count for a feed that has never failed, has just
// succeeded, or has been repaired. Named so every "no backoff" read and write
// reads intentionally rather than as a bare 0.
export const NO_CONSECUTIVE_FAILURES = 0;

// One scheduler tick. The first failure waits a single tick before retrying,
// matching the cadence a healthy feed already syncs at.
const BASE_BACKOFF_MS = 15 * 60 * 1000;

// Ceiling on the retry delay. A feed that keeps failing is retried at most
// once a day rather than backing off unbounded.
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

// Once 2^exponent would exceed the cap the exact value no longer matters, so
// the exponent is clamped below this so a huge failure count can't push
// 2 ** exponent to Infinity before Math.min pins the delay to the cap.
const MAX_BACKOFF_EXPONENT = 30;

// Delay, in milliseconds, to wait before the next retry given how many
// consecutive failures a feed has accumulated. Zero failures means no
// backoff at all.
export function computeBackoffDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return 0;
  }

  const exponent = Math.min(consecutiveFailures - 1, MAX_BACKOFF_EXPONENT);
  const delay = BASE_BACKOFF_MS * 2 ** exponent;

  return Math.min(delay, MAX_BACKOFF_MS);
}

// Timestamp before which the scheduler must not re-sync a failing feed. Null
// when the feed has no consecutive failures, so a healthy feed is never gated.
export function computeNextRetryAt(
  consecutiveFailures: number,
  from: Date,
): Date | null {
  if (consecutiveFailures <= 0) {
    return null;
  }

  return new Date(from.getTime() + computeBackoffDelayMs(consecutiveFailures));
}
