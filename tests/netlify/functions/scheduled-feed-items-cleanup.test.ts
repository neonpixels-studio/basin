import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import scheduledFeedItemsCleanup, {
  FEED_ITEM_RETENTION_MS,
  PRUNE_BATCH_SIZE,
  config,
} from "../../../netlify/functions/scheduled-feed-items-cleanup";

const {
  mockCreateDb,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockDelete,
  mockDeleteWhere,
} = vi.hoisted(() => ({
  mockCreateDb: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
}));

vi.mock("../../../netlify/functions/db", () => ({
  createDb: mockCreateDb,
}));

// The rows the select-prunable step returns; only the id per row is used to
// drive the follow-up delete, so a bare id apiece is enough.
function makePrunableRows(count: number): Array<{ id: number }> {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
}

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

describe("scheduled-feed-items-cleanup", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockCreateDb.mockReturnValue({ select: mockSelect, delete: mockDelete });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
    mockDelete.mockReturnValue({ where: mockDeleteWhere });
    mockDeleteWhere.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prunes only rows older than the retention window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-08T00:00:00.000Z"));
    mockLimit.mockResolvedValueOnce(makePrunableRows(2));

    await scheduledFeedItemsCleanup();

    const [whereClause] = mockWhere.mock.calls[0];
    const { sql, params } = new PgDialect().sqlToQuery(whereClause);

    expect(sql).toContain('"feed_items"."created_at" <');
    expect(params).toContain(
      new Date(Date.now() - FEED_ITEM_RETENTION_MS).toISOString(),
    );
  });

  it("preserves starred and saved items in the prune predicate", async () => {
    mockLimit.mockResolvedValueOnce(makePrunableRows(1));

    await scheduledFeedItemsCleanup();

    const [whereClause] = mockWhere.mock.calls[0];
    const { sql } = new PgDialect().sqlToQuery(whereClause);

    expect(sql).toContain('"feed_items"."starred" =');
    expect(sql).toContain('"feed_items"."saved_at" is null');
  });

  it("deletes exactly the prunable ids the select returned", async () => {
    mockLimit.mockResolvedValueOnce(makePrunableRows(3));

    await scheduledFeedItemsCleanup();

    expect(mockDelete).toHaveBeenCalledTimes(1);
    const [deleteWhereClause] = mockDeleteWhere.mock.calls[0];
    const { sql, params } = new PgDialect().sqlToQuery(deleteWhereClause);
    expect(sql).toContain('"feed_items"."id" in');
    expect(params).toEqual([1, 2, 3]);
  });

  it("does not issue a delete when nothing is prunable", async () => {
    mockLimit.mockResolvedValue([]);

    const response = await scheduledFeedItemsCleanup();

    expect(response.status).toBe(200);
    expect(mockDelete).not.toHaveBeenCalled();
    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-items-cleanup.complete",
    );
    expect(completeEvent).toMatchObject({ deletedCount: 0, complete: true });
  });

  it("keeps batching until a short batch signals the backlog is drained", async () => {
    mockLimit
      .mockResolvedValueOnce(makePrunableRows(PRUNE_BATCH_SIZE))
      .mockResolvedValueOnce(makePrunableRows(PRUNE_BATCH_SIZE))
      .mockResolvedValueOnce(makePrunableRows(2));

    await scheduledFeedItemsCleanup();

    expect(mockLimit).toHaveBeenCalledTimes(3);
    expect(mockDelete).toHaveBeenCalledTimes(3);

    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-items-cleanup.complete",
    );
    expect(completeEvent).toMatchObject({
      deletedCount: PRUNE_BATCH_SIZE * 2 + 2,
      complete: true,
    });
  });

  it("stops after the batch cap and reports the run as incomplete for the next invocation", async () => {
    mockLimit.mockResolvedValue(makePrunableRows(PRUNE_BATCH_SIZE));

    await scheduledFeedItemsCleanup();

    const completeEvent = findLoggedEvent(
      consoleLogSpy,
      "scheduled-feed-items-cleanup.complete",
    );
    expect(completeEvent).toMatchObject({ complete: false });
  });

  it("retains a meaningful window of feed history", () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(FEED_ITEM_RETENTION_MS).toBeGreaterThan(thirtyDaysMs);
  });

  it("runs on the configured daily schedule", () => {
    expect(config.schedule).toBe("30 3 * * *");
  });

  it("logs an error event and rethrows when a delete fails", async () => {
    mockLimit.mockResolvedValueOnce(makePrunableRows(2));
    mockDeleteWhere.mockRejectedValue(new Error("db unreachable"));

    await expect(scheduledFeedItemsCleanup()).rejects.toThrow("db unreachable");

    const errorEvent = findLoggedEvent(
      consoleErrorSpy,
      "scheduled-feed-items-cleanup.error",
    );
    expect(errorEvent).toMatchObject({ error: "db unreachable" });
  });

  it("logs an error event and rethrows when the select fails", async () => {
    mockLimit.mockRejectedValue(new Error("db unreachable"));

    await expect(scheduledFeedItemsCleanup()).rejects.toThrow("db unreachable");

    expect(mockDelete).not.toHaveBeenCalled();
    const errorEvent = findLoggedEvent(
      consoleErrorSpy,
      "scheduled-feed-items-cleanup.error",
    );
    expect(errorEvent).toMatchObject({ error: "db unreachable" });
  });
});
