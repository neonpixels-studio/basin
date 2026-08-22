import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  SYNC_FEED_EVENT_NAME,
  DEBOUNCE_WINDOW_MS,
} from "../../../netlify/functions/types";

// Mirrors BATCH_SIZE in netlify/functions/scheduled-feed-sync.ts. Not imported
// directly because the production module keeps it as a private implementation
// detail (not exported); this local constant documents that it must stay in
// sync if the production value ever changes.
const BATCH_SIZE = 25;

const { mockFindMany, mockSend, mockAsyncWorkloadsClient } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockSend: vi.fn(),
  mockAsyncWorkloadsClient: vi.fn(),
}));

vi.mock("../../../netlify/functions/db", () => ({
  createDb: vi.fn(() => ({
    query: {
      feeds: { findMany: mockFindMany },
    },
  })),
}));

vi.mock("@netlify/async-workloads", () => ({
  AsyncWorkloadsClient: mockAsyncWorkloadsClient,
}));

import scheduledFeedSync from "../../../netlify/functions/scheduled-feed-sync";

type DueFeed = { id: number; userId: number; source: string };

function makeDueFeed(overrides: Partial<DueFeed> = {}): DueFeed {
  return {
    id: 1,
    userId: 1,
    source: "rss",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (_value: T) => void;
  let reject!: (_reason?: unknown) => void;
  const promise = new Promise<T>((resolveExecutor, rejectExecutor) => {
    resolve = resolveExecutor;
    reject = rejectExecutor;
  });
  return { promise, resolve, reject };
}

// The production code logs structured JSON via console.log/console.error, but
// parses defensively in case any call ever logs a plain string instead — a
// malformed log line should not masquerade as an assertion failure elsewhere.
function parseLoggedEvents(
  spy: ReturnType<typeof vi.spyOn>,
): Record<string, unknown>[] {
  return spy.mock.calls.flatMap((entry) => {
    try {
      return [JSON.parse(entry[0] as string)];
    } catch {
      return [];
    }
  });
}

function findLoggedEvent(
  spy: ReturnType<typeof vi.spyOn>,
  eventName: string,
): Record<string, unknown> | undefined {
  return parseLoggedEvents(spy).find((entry) => entry.event === eventName);
}

describe("scheduled-feed-sync", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // A regular function, not an arrow function, so it can be invoked with `new`
    // the same way the production code does: `new AsyncWorkloadsClient()`.
    mockAsyncWorkloadsClient.mockImplementation(
      function AsyncWorkloadsClientMock() {
        return { send: mockSend };
      },
    );
    mockFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    // Guards against a fake-timer test throwing before it restores real
    // timers itself, which would otherwise leak fake timers into later tests
    // (e.g. the batching test's `vi.waitFor`, which relies on real timers).
    vi.useRealTimers();
  });

  it("returns 200 and logs no-due-feeds without creating an emit client when nothing is due", async () => {
    mockFindMany.mockResolvedValue([]);

    const response = await scheduledFeedSync();

    expect(response.status).toBe(200);
    expect(mockAsyncWorkloadsClient).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(
      findLoggedEvent(consoleLogSpy, "scheduled-feed-sync.no-due-feeds"),
    ).toBeDefined();
  });

  it("propagates a fetchDueFeeds failure without emitting any sync events", async () => {
    mockFindMany.mockRejectedValue(new Error("db unreachable"));

    await expect(scheduledFeedSync()).rejects.toThrow("db unreachable");

    expect(mockAsyncWorkloadsClient).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("selects only id, userId, and source columns for due feeds", async () => {
    await scheduledFeedSync();

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const [callArgs] = mockFindMany.mock.calls[0];
    expect(callArgs.columns).toEqual({ id: true, userId: true, source: true });
  });

  it("queries syncable source types and feeds past the debounce window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    await scheduledFeedSync();

    const [callArgs] = mockFindMany.mock.calls[0];
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(callArgs.where);

    expect(sql).toContain('"feeds"."source" in');
    expect(sql).toContain('"feeds"."last_fetched" is null');
    expect(sql).toContain('"feeds"."last_fetched" <');
    // Backoff gate: permanently-failing feeds have next_retry_at pushed into
    // the future so they are excluded until their retry window opens — see
    // server/utils/feedSyncBackoff.ts.
    expect(sql).toContain('"feeds"."next_retry_at" is null');
    // Assert the value bound to the next_retry_at predicate is `now`, so a feed
    // whose retry window has not opened yet is genuinely excluded — binding the
    // debounce cutoff or a stale time here would gate feeds early and this test
    // must catch that.
    const nextRetryPlaceholder = sql.match(
      /"feeds"\."next_retry_at" < \$(\d+)/,
    );
    expect(nextRetryPlaceholder).not.toBeNull();
    expect(params[Number(nextRetryPlaceholder![1]) - 1]).toBe(
      new Date("2026-01-01T00:00:00.000Z").toISOString(),
    );
    // Paused sources (over the Free cap after a downgrade) are excluded so they
    // stop pulling new content — see netlify/functions/scheduled-feed-sync.ts.
    // Assert the value bound to the paused predicate specifically is `false`, so
    // the filter can't silently invert to syncing only paused feeds and can't
    // pass just because some other boolean param happens to be false.
    const pausedPlaceholder = sql.match(/"feeds"\."paused" = \$(\d+)/);
    expect(pausedPlaceholder).not.toBeNull();
    expect(params[Number(pausedPlaceholder![1]) - 1]).toBe(false);
    expect(params.slice(0, 4)).toEqual([
      "rss",
      "podcast",
      "youtube",
      "bluesky",
    ]);
    expect(params[4]).toBe(
      new Date(Date.now() - DEBOUNCE_WINDOW_MS).toISOString(),
    );
  });

  it("emits a sync event with the correct payload for every due feed and counts them as emitted", async () => {
    const dueFeeds = [
      makeDueFeed({ id: 1, userId: 10, source: "rss" }),
      makeDueFeed({ id: 2, userId: 11, source: "podcast" }),
      makeDueFeed({ id: 3, userId: 12, source: "youtube" }),
    ];
    mockFindMany.mockResolvedValue(dueFeeds);
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "evt-1" });

    await scheduledFeedSync();

    expect(mockSend).toHaveBeenCalledTimes(3);
    for (const feed of dueFeeds) {
      expect(mockSend).toHaveBeenCalledWith(SYNC_FEED_EVENT_NAME, {
        data: {
          userId: feed.userId,
          feedId: feed.id,
          sourceType: feed.source,
          mode: "scheduled",
        },
      });
    }

    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-sync.complete",
    );
    expect(completeEvent).toMatchObject({ emitted: 3, failed: 0 });
  });

  it("counts a feed as failed and continues emitting the rest when the send status is not succeeded", async () => {
    const dueFeeds = [
      makeDueFeed({ id: 1 }),
      makeDueFeed({ id: 2 }),
      makeDueFeed({ id: 3 }),
    ];
    mockFindMany.mockResolvedValue(dueFeeds);
    mockSend
      .mockResolvedValueOnce({ sendStatus: "succeeded", eventId: "evt-1" })
      .mockResolvedValueOnce({ sendStatus: "failed", eventId: "evt-2" })
      .mockResolvedValueOnce({ sendStatus: "succeeded", eventId: "evt-3" });

    await scheduledFeedSync();

    expect(mockSend).toHaveBeenCalledTimes(3);
    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-sync.complete",
    );
    expect(completeEvent).toMatchObject({ emitted: 2, failed: 1 });

    const failedLog = findLoggedEvent(
      consoleErrorSpy,
      "scheduled-feed-sync.emit-failed",
    );
    expect(failedLog).toMatchObject({ feedId: 2 });
  });

  it("counts a feed as failed and continues emitting the rest when send rejects outright", async () => {
    const dueFeeds = [makeDueFeed({ id: 1 }), makeDueFeed({ id: 2 })];
    mockFindMany.mockResolvedValue(dueFeeds);
    mockSend
      .mockRejectedValueOnce(new Error("network unreachable"))
      .mockResolvedValueOnce({ sendStatus: "succeeded", eventId: "evt-2" });

    await scheduledFeedSync();

    expect(mockSend).toHaveBeenCalledTimes(2);
    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-sync.complete",
    );
    expect(completeEvent).toMatchObject({ emitted: 1, failed: 1 });

    const failedLog = findLoggedEvent(
      consoleErrorSpy,
      "scheduled-feed-sync.emit-failed",
    );
    expect(failedLog).toMatchObject({
      feedId: 1,
      error: "network unreachable",
    });
  });

  it("batches emission into sequential groups of BATCH_SIZE instead of firing all due feeds at once", async () => {
    const totalDueFeeds = BATCH_SIZE + 5;
    const dueFeeds = Array.from({ length: totalDueFeeds }, (_, index) =>
      makeDueFeed({ id: index + 1 }),
    );
    mockFindMany.mockResolvedValue(dueFeeds);

    const deferreds = Array.from({ length: totalDueFeeds }, () =>
      createDeferred<{ sendStatus: string; eventId: string }>(),
    );
    let nextCallIndex = 0;
    mockSend.mockImplementation(() => deferreds[nextCallIndex++].promise);

    const resultPromise = scheduledFeedSync();

    // The first batch should be dispatched in full before anything resolves.
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(BATCH_SIZE));
    expect(mockSend).toHaveBeenCalledTimes(BATCH_SIZE);

    deferreds
      .slice(0, BATCH_SIZE)
      .forEach((deferred, index) =>
        deferred.resolve({ sendStatus: "succeeded", eventId: `evt-${index}` }),
      );

    // Only after the first batch settles should the remaining feeds be sent.
    await vi.waitFor(() =>
      expect(mockSend).toHaveBeenCalledTimes(totalDueFeeds),
    );
    expect(mockSend).toHaveBeenCalledTimes(totalDueFeeds);

    deferreds.slice(BATCH_SIZE).forEach((deferred, index) =>
      deferred.resolve({
        sendStatus: "succeeded",
        eventId: `evt-${BATCH_SIZE + index}`,
      }),
    );

    await resultPromise;

    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-sync.complete",
    );
    expect(completeEvent).toMatchObject({
      emitted: totalDueFeeds,
      failed: 0,
    });
  });
});
