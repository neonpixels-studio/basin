import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSyncQueue, MAX_SYNC_ATTEMPTS } from "~/composables/useSyncQueue";
import { syncQueueStore } from "~/composables/syncQueueStore";
// @sentry/nuxt is mocked once, globally, in tests/setup.ts — see that file's
// comment for why a module-scoped mock here instead would silently miss the
// calls app/lib/sentry.ts makes.
import * as SentrySDK from "@sentry/nuxt";
import { mockSentryScope } from "../setup";

vi.mock("~/composables/syncQueueStore", () => ({
  syncQueueStore: {
    insertAction: vi.fn(),
    getPendingItems: vi.fn(),
    countFailedItems: vi.fn(),
    markSynced: vi.fn(),
    recordRetryableFailure: vi.fn(),
    quarantine: vi.fn(),
    requeueFailedItems: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const fakeDb = { name: "fake-db" };
const mockUseClientDb = vi.fn();
vi.stubGlobal("useClientDb", mockUseClientDb);

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    action: "markRead",
    payload: JSON.stringify({ feedId: 1, guid: "abc" }),
    attempts: 0,
    status: "pending",
    lastError: null,
    failedAt: null,
    createdAt: new Date("2026-01-01"),
    syncedAt: null,
    ...overrides,
  };
}

// The shape $fetch rejects with — extractStatusCode() in useSyncQueue.ts
// reads .statusCode off the Error itself, not off a response body.
function makeHttpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe("useSyncQueue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    mockUseClientDb.mockResolvedValue(fakeDb);
    vi.mocked(syncQueueStore.countFailedItems).mockResolvedValue(0);
  });

  describe("queueAction()", () => {
    it("inserts the action with a JSON-stringified payload", async () => {
      const { queueAction } = useSyncQueue();
      await queueAction("star", { feedId: 1, guid: "abc", starred: true });
      expect(syncQueueStore.insertAction).toHaveBeenCalledWith(
        fakeDb,
        "star",
        JSON.stringify({ feedId: 1, guid: "abc", starred: true }),
      );
    });
  });

  describe("flushSyncQueue()", () => {
    it("does nothing while offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();
      expect(syncQueueStore.getPendingItems).not.toHaveBeenCalled();
    });

    it("drains the queue fully when every item succeeds", async () => {
      const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockResolvedValue({ ok: true });

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 1);
      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 2);
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
      expect(syncQueueStore.recordRetryableFailure).not.toHaveBeenCalled();
    });

    it("does not quarantine an item whose local markSynced write fails after a successful POST", async () => {
      // The mutation already reached the server — a failure recording that
      // fact locally is a PGlite bookkeeping problem, not a sync failure,
      // and must never feed the transient/permanent classifier.
      const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockResolvedValue({ ok: true });
      const markSyncedError = new Error("DB write failed");
      vi.mocked(syncQueueStore.markSynced).mockRejectedValueOnce(
        markSyncedError,
      );

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
      expect(syncQueueStore.recordRetryableFailure).not.toHaveBeenCalled();
      // The pass continued to item 2 rather than stopping.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 2);
      expect(SentrySDK.captureException).toHaveBeenCalledWith(markSyncedError);
    });

    it("stops the pass (without quarantining) when recording an outcome throws unexpectedly", async () => {
      // If quarantine/recordRetryableFailure itself throws (a broken local
      // DB), the item's true outcome wasn't persisted — safest is to leave
      // it pending and stop, not guess, and not let the rejection escape as
      // an unhandled rejection from the bare flushSyncQueue() calls in
      // app/plugins/sync.client.ts.
      const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      const recordFailureError = new Error("DB write failed");
      vi.mocked(syncQueueStore.recordRetryableFailure).mockRejectedValueOnce(
        recordFailureError,
      );

      const { flushSyncQueue } = useSyncQueue();
      await expect(flushSyncQueue()).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
      expect(SentrySDK.captureException).toHaveBeenCalledWith(
        recordFailureError,
      );
    });

    it("quarantines a permanently-failing (403) item without blocking items behind it", async () => {
      const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      const forbidden = Object.assign(new Error("Forbidden"), {
        statusCode: 403,
      });
      mockFetch
        .mockRejectedValueOnce(forbidden)
        .mockResolvedValueOnce({ ok: true });

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(syncQueueStore.quarantine).toHaveBeenCalledWith(
        fakeDb,
        1,
        1,
        "Forbidden",
      );
      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 2);
      expect(syncQueueStore.recordRetryableFailure).not.toHaveBeenCalled();
    });

    it("reports a permanently-failing (403) item to Sentry with actionable context and no raw payload", async () => {
      // This is a real data-loss path — the mutation is dropped for good —
      // so it must be reported, unlike a routine retryable failure.
      const items = [
        makeItem({
          id: 1,
          action: "star",
          payload: JSON.stringify({ feedId: 1, guid: "secret-guid" }),
        }),
      ];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      const forbidden = Object.assign(new Error("Forbidden"), {
        statusCode: 403,
      });
      mockFetch.mockRejectedValueOnce(forbidden);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(SentrySDK.captureException).toHaveBeenCalledWith(forbidden);
      expect(mockSentryScope.setExtras).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "sync-queue-item-quarantined",
          reason: "permanent-failure",
          action: "star",
          itemId: 1,
          attempts: 1,
          statusCode: 403,
        }),
      );
      const reportedExtras = vi.mocked(mockSentryScope.setExtras).mock
        .calls[0]?.[0];
      expect(JSON.stringify(reportedExtras)).not.toContain("secret-guid");
    });

    it("reports quarantine-by-exhausted-retry-budget to Sentry with that reason", async () => {
      const item = makeItem({ id: 1, attempts: 4 });
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([item]);
      const stillDown = new Error("Still down");
      mockFetch.mockRejectedValueOnce(stillDown);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(SentrySDK.captureException).toHaveBeenCalledWith(stillDown);
      expect(mockSentryScope.setExtras).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "sync-queue-item-quarantined",
          reason: "retry-budget-exhausted",
          itemId: 1,
          attempts: 5,
        }),
      );
    });

    it("does not report a still-retryable failure to Sentry", async () => {
      const items = [makeItem({ id: 1 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(SentrySDK.captureException).not.toHaveBeenCalled();
    });

    // Documents a deliberate tradeoff: not head-of-line-blocking on a
    // permanent failure means a later mutation for the *same* entity can
    // apply even though an earlier one for that entity was quarantined.
    // That's the intended behavior — the alternative (blocking everything
    // behind a row that can never succeed) is exactly bug #122.
    it("lets a later mutation for the same entity apply after an earlier one is quarantined", async () => {
      const samePayload = JSON.stringify({ feedId: 1, guid: "abc" });
      const items = [
        makeItem({ id: 1, action: "star", payload: samePayload }),
        makeItem({ id: 2, action: "star", payload: samePayload }),
      ];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      const forbidden = Object.assign(new Error("Forbidden"), {
        statusCode: 403,
      });
      mockFetch
        .mockRejectedValueOnce(forbidden)
        .mockResolvedValueOnce({ ok: true });

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.quarantine).toHaveBeenCalledWith(
        fakeDb,
        1,
        1,
        "Forbidden",
      );
      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 2);
    });

    it("keeps a transiently-failing item queued for retry and stops the pass", async () => {
      const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        1,
        "Network error",
      );
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
      expect(syncQueueStore.markSynced).not.toHaveBeenCalled();
    });

    it("keeps a 5xx failure queued for retry rather than quarantining it", async () => {
      const items = [makeItem({ id: 1 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      const serverError = makeHttpError("Bad Gateway", 502);
      mockFetch.mockRejectedValueOnce(serverError);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        1,
        "Bad Gateway",
      );
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
    });

    it("treats a 401 as retryable rather than quarantining the whole queue", async () => {
      // A 401 means the session needs refreshing, not that the mutation
      // itself is invalid — quarantining it would nuke every pending item
      // in a single flush the moment a session expires.
      const items = [makeItem({ id: 1 }), makeItem({ id: 2 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      const unauthorized = makeHttpError("Unauthorized", 401);
      mockFetch.mockRejectedValueOnce(unauthorized);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Attempts is left unchanged (0, not incremented to 1) — a 401 must
      // never draw from MAX_SYNC_ATTEMPTS. See the #311 regression tests
      // below ("does not quarantine a 401 even when..." and "keeps retrying
      // through repeated 401s...") for why this matters.
      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        0,
        "Unauthorized",
      );
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
    });

    it("does not quarantine a 401 even when the item is already at the edge of the retry budget", async () => {
      // Regression test for #311. attempts: MAX_SYNC_ATTEMPTS - 1 is the same
      // edge case as "respects the retry bound — quarantines once it's
      // reached" above — for any *other* failure, attempts + 1 reaches
      // MAX_SYNC_ATTEMPTS and the item gets quarantined. A 401 must not
      // advance attempts at all, so it must survive this exact edge
      // untouched.
      const item = makeItem({ id: 1, attempts: MAX_SYNC_ATTEMPTS - 1 });
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([item]);
      const unauthorized = makeHttpError("Unauthorized", 401);
      mockFetch.mockRejectedValueOnce(unauthorized);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        MAX_SYNC_ATTEMPTS - 1,
        "Unauthorized",
      );
    });

    it("does not report a 401 to Sentry", async () => {
      // A 401 is an expected, routine condition (an expired session) — it
      // must not be treated as a data-loss event the way a real quarantine
      // is, even when the item is sitting right at the edge of the budget.
      const item = makeItem({ id: 1, attempts: MAX_SYNC_ATTEMPTS - 1 });
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([item]);
      const unauthorized = makeHttpError("Unauthorized", 401);
      mockFetch.mockRejectedValueOnce(unauthorized);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(SentrySDK.captureException).not.toHaveBeenCalled();
    });

    it("resumes counting from the preserved attempts value after a 401 is followed by a genuine transient failure", async () => {
      // The freeze only applies while the failure is a 401 — once the
      // session is valid again but the server itself is unhappy (a 5xx), the
      // item goes back to drawing from the normal budget starting from
      // wherever it was frozen, not from zero. Uses stateful mocks (like
      // "keeps retrying through repeated 401s" above) so the second flush
      // pass reads back what the first pass actually persisted, rather than
      // a static row that would make the second assertion pass regardless
      // of what the 401 branch wrote.
      const afterAuthFailureAttempts = 3;
      let persistedAttempts = afterAuthFailureAttempts;
      vi.mocked(syncQueueStore.getPendingItems).mockImplementation(async () => [
        makeItem({ id: 1, attempts: persistedAttempts }),
      ]);
      vi.mocked(syncQueueStore.recordRetryableFailure).mockImplementation(
        async (_db, _id, attempts) => {
          persistedAttempts = attempts;
        },
      );
      const unauthorized = makeHttpError("Unauthorized", 401);
      mockFetch.mockRejectedValueOnce(unauthorized);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(persistedAttempts).toBe(afterAuthFailureAttempts);
      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        afterAuthFailureAttempts,
        "Unauthorized",
      );

      const serverError = makeHttpError("Bad Gateway", 502);
      mockFetch.mockRejectedValueOnce(serverError);
      await flushSyncQueue();

      expect(persistedAttempts).toBe(afterAuthFailureAttempts + 1);
      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        afterAuthFailureAttempts + 1,
        "Bad Gateway",
      );
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
    });

    it("keeps retrying through repeated 401s and syncs once reauthenticated", async () => {
      // The other half of #311. Unlike the other tests in this file, the
      // store mocks here are stateful (mirroring what recordRetryableFailure
      // persists back into the row getPendingItems next returns) so this
      // exercises a realistic sequence of flush passes rather than the same
      // static row on every call — otherwise a naive "attempts never comes
      // back incremented" assertion would pass even against the pre-fix
      // code, which read the same stale attempts value every time too.
      let persistedAttempts = 0;
      vi.mocked(syncQueueStore.getPendingItems).mockImplementation(async () => [
        makeItem({ id: 1, attempts: persistedAttempts }),
      ]);
      vi.mocked(syncQueueStore.recordRetryableFailure).mockImplementation(
        async (_db, _id, attempts) => {
          persistedAttempts = attempts;
        },
      );
      const unauthorized = makeHttpError("Unauthorized", 401);

      const { flushSyncQueue } = useSyncQueue();
      const passesBeyondRetryBudget = MAX_SYNC_ATTEMPTS + 3;
      for (
        let passIndex = 0;
        passIndex < passesBeyondRetryBudget;
        passIndex += 1
      ) {
        mockFetch.mockRejectedValueOnce(unauthorized);
        await flushSyncQueue();
      }

      // Every pass genuinely retried against the server (not silently
      // skipped) and recorded its outcome, yet attempts never advanced.
      expect(mockFetch).toHaveBeenCalledTimes(passesBeyondRetryBudget);
      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledTimes(
        passesBeyondRetryBudget,
      );
      expect(persistedAttempts).toBe(0);
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();

      // Reauthentication happens; the next pass's request succeeds.
      mockFetch.mockResolvedValueOnce({ ok: true });
      await flushSyncQueue();

      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 1);
    });

    it("quarantines an item with an unparseable payload without calling $fetch", async () => {
      const items = [
        makeItem({ id: 1, payload: "{not valid json" }),
        makeItem({ id: 2 }),
      ];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockResolvedValue({ ok: true });

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.quarantine).toHaveBeenCalledWith(
        fakeDb,
        1,
        1,
        expect.any(String),
      );
      // Item 1 never reached the network — only item 2's request was made.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(syncQueueStore.markSynced).toHaveBeenCalledWith(fakeDb, 2);
    });

    it("reports an unparseable payload to Sentry with actionable context and no raw payload content", async () => {
      // This is the other real data-loss path: the payload will never parse
      // on a later attempt either, so it's quarantined and must be reported.
      const items = [
        makeItem({ id: 1, action: "save", payload: "{not valid json" }),
      ];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(SentrySDK.captureException).toHaveBeenCalledWith(
        expect.any(Error),
      );
      expect(mockSentryScope.setExtras).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "sync-queue-item-quarantined",
          reason: "unparseable-payload",
          action: "save",
          itemId: 1,
          attempts: 1,
        }),
      );
      const reportedExtras = vi.mocked(mockSentryScope.setExtras).mock
        .calls[0]?.[0];
      expect(JSON.stringify(reportedExtras)).not.toContain("not valid json");
    });

    it("does not start a second pass while one is already in flight", async () => {
      const items = [makeItem({ id: 1 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockResolvedValue({ ok: true });

      // Two callers firing back to back (e.g. the "online" and
      // "visibilitychange" listeners both reacting to the same reconnect)
      // must share one pass rather than each reading their own snapshot of
      // `attempts` and double-incrementing it.
      const { flushSyncQueue } = useSyncQueue();
      const firstPass = flushSyncQueue();
      const secondPass = flushSyncQueue();
      await Promise.all([firstPass, secondPass]);

      expect(syncQueueStore.getPendingItems).toHaveBeenCalledTimes(1);
    });

    it("respects the retry bound — keeps retrying below it", async () => {
      const item = makeItem({ id: 1, attempts: 3 });
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([item]);
      mockFetch.mockRejectedValueOnce(new Error("Still down"));

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.recordRetryableFailure).toHaveBeenCalledWith(
        fakeDb,
        1,
        4,
        "Still down",
      );
      expect(syncQueueStore.quarantine).not.toHaveBeenCalled();
    });

    it("respects the retry bound — quarantines once it's reached", async () => {
      const item = makeItem({ id: 1, attempts: 4 });
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([item]);
      mockFetch.mockRejectedValueOnce(new Error("Still down"));

      const { flushSyncQueue } = useSyncQueue();
      await flushSyncQueue();

      expect(syncQueueStore.quarantine).toHaveBeenCalledWith(
        fakeDb,
        1,
        5,
        "Still down",
      );
      expect(syncQueueStore.recordRetryableFailure).not.toHaveBeenCalled();
    });

    it("refreshes failedCount after a pass", async () => {
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([]);
      vi.mocked(syncQueueStore.countFailedItems).mockResolvedValue(3);

      const { flushSyncQueue, failedCount } = useSyncQueue();
      await flushSyncQueue();

      expect(failedCount.value).toBe(3);
    });
  });

  describe("flushSyncQueue() outer failure", () => {
    it("reports to Sentry exactly once when the flush pass fails outright (e.g. IndexedDB unavailable)", async () => {
      // mockRejectedValue (not -Once): the client DB stays broken for every
      // call, including the refresh a naive `finally` would still attempt —
      // this is what catches a regression back to double-reporting the same
      // failure once for the flush pass and again for the count refresh.
      const dbError = new Error("IndexedDB unavailable");
      mockUseClientDb.mockRejectedValue(dbError);

      const { flushSyncQueue } = useSyncQueue();
      await expect(flushSyncQueue()).resolves.toBeUndefined();

      expect(SentrySDK.captureException).toHaveBeenCalledTimes(1);
      expect(SentrySDK.captureException).toHaveBeenCalledWith(dbError);
    });

    it("still refreshes the count exactly once when the client DB opened fine but reading pending items failed", async () => {
      // Unlike the client-DB-broken case above, the connection itself is
      // healthy here — the count read must still happen (otherwise the
      // banner goes stale on a failure unrelated to useClientDb()), but only
      // once, reusing the already-open connection rather than opening (and
      // risking failing on) a second one.
      const pendingItemsError = new Error("object store missing");
      vi.mocked(syncQueueStore.getPendingItems).mockRejectedValue(
        pendingItemsError,
      );
      vi.mocked(syncQueueStore.countFailedItems).mockResolvedValue(2);

      const { flushSyncQueue, failedCount } = useSyncQueue();
      await expect(flushSyncQueue()).resolves.toBeUndefined();

      expect(mockUseClientDb).toHaveBeenCalledTimes(1);
      expect(SentrySDK.captureException).toHaveBeenCalledTimes(1);
      expect(SentrySDK.captureException).toHaveBeenCalledWith(
        pendingItemsError,
      );
      expect(failedCount.value).toBe(2);
    });

    it("resolves (and reports each failure once, under its own stage) when both reading pending items and refreshing the count fail", async () => {
      // The uncovered path this guards: refreshing the count from the catch
      // path used to be unguarded, so a countFailedItems() rejection here
      // (on an otherwise-healthy connection) would itself become an
      // unhandled rejection out of flushSyncQueue() — exactly what the outer
      // try/catch exists to prevent.
      const pendingItemsError = new Error("object store missing");
      const countError = new Error("count read also failed");
      vi.mocked(syncQueueStore.getPendingItems).mockRejectedValue(
        pendingItemsError,
      );
      vi.mocked(syncQueueStore.countFailedItems).mockRejectedValue(countError);

      const { flushSyncQueue } = useSyncQueue();
      await expect(flushSyncQueue()).resolves.toBeUndefined();

      expect(SentrySDK.captureException).toHaveBeenCalledTimes(2);
      expect(SentrySDK.captureException).toHaveBeenCalledWith(
        pendingItemsError,
      );
      expect(SentrySDK.captureException).toHaveBeenCalledWith(countError);
    });

    it("labels a happy-path count-refresh failure with its own stage, not the flush pass's", async () => {
      const happyPathCountError = new Error("count read failed");
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([]);
      vi.mocked(syncQueueStore.countFailedItems).mockRejectedValue(
        happyPathCountError,
      );

      const { flushSyncQueue } = useSyncQueue();
      await expect(flushSyncQueue()).resolves.toBeUndefined();

      expect(SentrySDK.captureException).toHaveBeenCalledTimes(1);
      expect(SentrySDK.captureException).toHaveBeenCalledWith(
        happyPathCountError,
      );
      expect(mockSentryScope.setExtras).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "sync-queue-refresh-failed-count",
        }),
      );
    });
  });

  describe("refreshFailedCount()", () => {
    it("sets failedCount from the store", async () => {
      vi.mocked(syncQueueStore.countFailedItems).mockResolvedValue(2);
      const { refreshFailedCount, failedCount } = useSyncQueue();
      await refreshFailedCount();
      expect(failedCount.value).toBe(2);
    });

    it("resolves without throwing and keeps the last known count when the store rejects", async () => {
      // A read failure must never claim "zero failures" — that would hide
      // real quarantined items from the banner — so the previous value is
      // preserved rather than reset.
      vi.mocked(syncQueueStore.countFailedItems).mockResolvedValueOnce(4);
      const { refreshFailedCount, failedCount } = useSyncQueue();
      await refreshFailedCount();
      expect(failedCount.value).toBe(4);

      const countError = new Error("DB unavailable");
      vi.mocked(syncQueueStore.countFailedItems).mockRejectedValueOnce(
        countError,
      );
      await expect(refreshFailedCount()).resolves.toBeUndefined();
      expect(failedCount.value).toBe(4);
      expect(SentrySDK.captureException).toHaveBeenCalledWith(countError);
    });
  });

  describe("retryFailedItems()", () => {
    it("re-queues failed items and immediately attempts a flush", async () => {
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue([]);

      const { retryFailedItems } = useSyncQueue();
      await retryFailedItems();

      expect(syncQueueStore.requeueFailedItems).toHaveBeenCalledWith(fakeDb);
      expect(syncQueueStore.getPendingItems).toHaveBeenCalled();
    });

    it("still refreshes failedCount when the flush it triggers no-ops offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      vi.mocked(syncQueueStore.countFailedItems).mockResolvedValue(0);

      const { retryFailedItems, failedCount } = useSyncQueue();
      failedCount.value = 3;
      await retryFailedItems();

      expect(syncQueueStore.requeueFailedItems).toHaveBeenCalledWith(fakeDb);
      // Offline means nothing was actually resent — getPendingItems is
      // never reached — but the count must still reflect the requeue.
      expect(syncQueueStore.getPendingItems).not.toHaveBeenCalled();
      expect(failedCount.value).toBe(0);
    });

    it("guarantees a fresh pass that starts after the requeue commits, even if one was already in flight", async () => {
      const items = [makeItem({ id: 1 })];
      vi.mocked(syncQueueStore.getPendingItems).mockResolvedValue(items);
      mockFetch.mockResolvedValue({ ok: true });

      const { flushSyncQueue, retryFailedItems } = useSyncQueue();
      const inFlightPass = flushSyncQueue();
      await retryFailedItems();
      await inFlightPass;

      // The already-running pass's own getPendingItems is one call;
      // retryFailedItems() must still guarantee a second, fresh
      // getPendingItems call that starts after requeueFailedItems commits
      // (rather than requeueFailedItems racing a pass that reads pending
      // items before the requeue lands and then reports success).
      expect(syncQueueStore.getPendingItems).toHaveBeenCalledTimes(2);
      const requeueOrder = vi.mocked(syncQueueStore.requeueFailedItems).mock
        .invocationCallOrder[0];
      const secondGetPendingOrder = vi.mocked(syncQueueStore.getPendingItems)
        .mock.invocationCallOrder[1];
      expect(requeueOrder).toBeLessThan(secondGetPendingOrder);
    });
  });
});
