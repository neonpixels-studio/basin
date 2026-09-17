import { ref } from "vue";
import {
  syncQueueStore,
  type ClientDb,
  type SyncQueueAction,
  type SyncQueueRow,
} from "./syncQueueStore";
import { captureException } from "~/lib/sentry";

// A queued mutation gets this many attempts against a transient failure
// (network error, 5xx) before it's quarantined too — a persistently-erroring
// server must not retry forever and silently pile up behind it.
const MAX_SYNC_ATTEMPTS = 5;
const DEFAULT_SYNC_ERROR_MESSAGE = "Sync failed";
const DEFAULT_PARSE_ERROR_MESSAGE = "Queued payload could not be parsed";
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

// 4xx statuses that don't mean "this request can never succeed" — they mean
// "try again once the underlying condition clears" (session refreshed, rate
// limit window passed). Everything else in the 4xx range is the server
// rejecting the request's content itself (ownership check, validation,
// unknown action), which retrying verbatim can never fix.
const RETRYABLE_CLIENT_ERROR_STATUSES = new Set([401, 408, 429]);

// Number of sync_queue rows currently quarantined (status "failed"). Module-
// level so every useSyncQueue() call — the sync plugin, the UI banner —
// shares the same reactive count instead of each holding its own copy.
const failedCount = ref(0);

// Guards against overlapping flush passes — app/plugins/sync.client.ts wires
// flushSyncQueue to both the "online" and "visibilitychange" events, which
// commonly fire back to back (e.g. a laptop waking with network already
// restored). Two concurrent passes would both read the same pre-failure
// `attempts` snapshot for an item and both increment it from there, silently
// stretching its real retry budget.
let flushInFlight: Promise<void> | null = null;

function extractStatusCode(error: unknown): number | null {
  const hasNumericStatusCode =
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number";

  return hasNumericStatusCode
    ? (error as { statusCode: number }).statusCode
    : null;
}

// A 4xx response (other than the retryable ones above) means the server
// rejected the request's content itself — retrying the exact same payload
// can never succeed. Anything else (no status, a network error, a 5xx) is
// transient and worth retrying.
function isPermanentFailure(statusCode: number | null): boolean {
  if (statusCode === null || RETRYABLE_CLIENT_ERROR_STATUSES.has(statusCode)) {
    return false;
  }
  return (
    statusCode >= HTTP_CLIENT_ERROR_MIN && statusCode < HTTP_SERVER_ERROR_MIN
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : DEFAULT_SYNC_ERROR_MESSAGE;
}

// Records a failed sync attempt and decides its fate. Returns whether the
// item is still retryable — false means it was quarantined (permanent 4xx,
// or its retry budget is exhausted).
async function handleSyncFailure(
  db: ClientDb,
  item: SyncQueueRow,
  error: unknown,
): Promise<boolean> {
  const statusCode = extractStatusCode(error);
  const message = describeError(error);
  const attempts = item.attempts + 1;
  const retryBudgetExhausted = attempts >= MAX_SYNC_ATTEMPTS;

  if (isPermanentFailure(statusCode) || retryBudgetExhausted) {
    await syncQueueStore.quarantine(db, item.id, attempts, message);
    return false;
  }

  await syncQueueStore.recordRetryableFailure(db, item.id, attempts, message);
  return true;
}

// A payload that can't be parsed back into JSON will never parse on a later
// attempt either — that's permanent, regardless of how many attempts remain.
async function quarantineUnparseablePayload(
  db: ClientDb,
  item: SyncQueueRow,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error ? error.message : DEFAULT_PARSE_ERROR_MESSAGE;
  await syncQueueStore.quarantine(db, item.id, item.attempts + 1, message);
}

// Sends one queued item to the server and reconciles its local state.
// Returns whether the caller should stop processing the rest of this pass —
// true only for a still-retryable transient failure, so item ordering is
// preserved for the next flush. Permanent failures (including an
// unparseable payload) are quarantined here and never stop the pass, so
// they can't block items queued behind them.
async function syncItem(db: ClientDb, item: SyncQueueRow): Promise<boolean> {
  let payload: unknown;
  try {
    payload = JSON.parse(item.payload);
  } catch (error) {
    await quarantineUnparseablePayload(db, item, error);
    return false;
  }

  try {
    await $fetch("/api/sync", {
      method: "POST",
      body: { action: item.action, payload },
    });
  } catch (error) {
    return handleSyncFailure(db, item, error);
  }

  // The mutation already reached the server at this point — a failure here
  // is purely local bookkeeping (a PGlite write), not a sync failure, so it
  // must never be routed through handleSyncFailure's classification. Doing
  // so could eventually quarantine a mutation that has, in fact, synced.
  try {
    await syncQueueStore.markSynced(db, item.id);
  } catch (error) {
    console.error("Failed to record a synced sync_queue item locally", error);
    captureException(error, {
      stage: "sync-queue-mark-synced",
      itemId: item.id,
    });
  }
  return false;
}

// Runs one item and reports its outcome to the local DB. If recording that
// outcome (quarantine / recordRetryableFailure / markSynced) itself throws —
// a broken local PGlite, not a sync failure — the item's true state wasn't
// persisted, so it's safest to leave it pending and stop the pass rather
// than plow through the rest of the queue against a database that isn't
// working. That's the same "stop the pass" behavior a transient sync
// failure gets, applied here for the same reason: don't guess at an
// unrecorded outcome.
async function processItem(db: ClientDb, item: SyncQueueRow): Promise<boolean> {
  try {
    return await syncItem(db, item);
  } catch (error) {
    console.error(
      "Failed to record a sync_queue item's outcome locally",
      error,
    );
    captureException(error, {
      stage: "sync-queue-record-outcome",
      itemId: item.id,
    });
    return true;
  }
}

// Runs the actual offline-check/pending-loop/refresh sequence, so runFlushPass
// can wrap it in exactly one try/catch. Refreshing the count is folded into
// both this function's exits (offline and success) rather than a `finally` on
// the caller, so a genuine failure below (useClientDb()/getPendingItems()
// throwing) propagates straight to that one catch instead of also retrying
// the identically-broken client DB here — which would double-report the same
// underlying failure to Sentry.
async function flushPendingItems(): Promise<void> {
  if (!navigator.onLine) {
    await refreshFailedCount();
    return;
  }

  const db = await useClientDb();
  const pending = await syncQueueStore.getPendingItems(db);

  for (const item of pending) {
    const stillRetryable = await processItem(db, item);
    if (stillRetryable) {
      break;
    }
  }

  await refreshFailedCount(db);
}

async function runFlushPass(): Promise<void> {
  try {
    await flushPendingItems();
  } catch (error) {
    // useClientDb()/getPendingItems() itself failing (IndexedDB unavailable,
    // quota exceeded) must not become an unhandled rejection — the plugin
    // calls flushSyncQueue() without awaiting or catching it. Deliberately
    // does not also call refreshFailedCount() here: it would fail against the
    // same broken client DB and double-report this one failure.
    console.error("Sync queue flush pass failed", error);
    captureException(error, { stage: "sync-queue-flush-pass" });
  }
}

// Best-effort read — a database that can't be reached has no failed rows to
// report, so a failure here must never surface as an unhandled rejection
// (e.g. from the UI banner's onMounted hook) or interrupt a flush pass. It
// also must not claim zero failures when the read itself is what failed —
// that would hide real quarantined items — so the previous count is kept.
// Accepts an already-open `db` so a caller mid-flush-pass reuses its
// connection instead of opening (and risking failing on) a second one.
async function refreshFailedCount(db?: ClientDb): Promise<void> {
  try {
    const clientDb = db ?? (await useClientDb());
    failedCount.value = await syncQueueStore.countFailedItems(clientDb);
  } catch (error) {
    console.error("Failed to refresh the quarantined sync queue count", error);
    captureException(error, { stage: "sync-queue-refresh-failed-count" });
  }
}

export function useSyncQueue() {
  async function queueAction(
    action: SyncQueueAction,
    payload: Record<string, unknown>,
  ) {
    const db = await useClientDb();
    await syncQueueStore.insertAction(db, action, JSON.stringify(payload));
  }

  // Callers already in flight share the same pass instead of starting a
  // second one — see the flushInFlight comment above.
  async function flushSyncQueue(): Promise<void> {
    if (flushInFlight) {
      return flushInFlight;
    }

    flushInFlight = runFlushPass().finally(() => {
      flushInFlight = null;
    });
    return flushInFlight;
  }

  // Re-queues every quarantined item (for a user-initiated "try again"),
  // then guarantees a flush pass that starts *after* the requeue has
  // committed. Requeuing happens first and unconditionally: waiting for an
  // in-flight pass before requeuing would still leave a window where a new
  // pass starts between that wait and the requeue actually committing,
  // snapshots the old (still-failed) rows, and — since flushSyncQueue()
  // then just returns that already-running pass — reports the retry as
  // done via refreshFailedCount() without anything having been resent.
  // Requeuing unconditionally first, then waiting out whatever pass is (or
  // becomes) in flight before starting a guaranteed-fresh one, closes that
  // window: any pass still running by the time flushSyncQueue() is called
  // below is guaranteed to have started after the requeue committed.
  async function retryFailedItems(): Promise<void> {
    const db = await useClientDb();
    await syncQueueStore.requeueFailedItems(db);

    while (flushInFlight) {
      await flushInFlight;
    }
    await flushSyncQueue();
  }

  return {
    queueAction,
    flushSyncQueue,
    retryFailedItems,
    failedCount,
    refreshFailedCount,
  };
}
