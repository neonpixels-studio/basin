import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { deletionTombstones } from "../../../server/db/schema";

const mockTombstoneFindFirst = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();

vi.stubGlobal("useDb", () => ({
  query: { deletionTombstones: { findFirst: mockTombstoneFindFirst } },
  insert: mockInsert,
}));

import {
  isProviderTombstoned,
  recordDeletionTombstone,
  MAX_CLERK_SESSION_LIFETIME_MS,
} from "../../../server/utils/tombstone";

const dialect = new PgDialect();

// Compare two drizzle SQL conditions by their rendered SQL + params, so a test
// fails if the lookup ever drops or changes its provider_id filter.
function sameCondition(actual: unknown, expected: unknown): boolean {
  const actualQuery = dialect.sqlToQuery(actual as never);
  const expectedQuery = dialect.sqlToQuery(expected as never);
  return (
    actualQuery.sql === expectedQuery.sql &&
    JSON.stringify(actualQuery.params) === JSON.stringify(expectedQuery.params)
  );
}

describe("tombstone", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({
      onConflictDoUpdate: mockOnConflictDoUpdate,
    });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
  });

  // Pin the retention window to the literal policy value independently of the
  // export, so shrinking or growing the constant fails the suite instead of
  // silently sliding every window-relative assertion below with it.
  it("retains tombstones for the seven-day Clerk session window", () => {
    expect(MAX_CLERK_SESSION_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  describe("isProviderTombstoned", () => {
    // Freeze the clock so window-boundary assertions compare against the exact
    // instant the test builds deletedAt from, rather than a few ms later.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is true when a recent tombstone row exists for the provider id", async () => {
      mockTombstoneFindFirst.mockResolvedValue({
        providerId: "clerk_gone",
        deletedAt: new Date(),
      });

      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(true);
    });

    it("is true when a tombstone has no deletedAt (fails closed) and logs the provider id", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockTombstoneFindFirst.mockResolvedValue({
        providerId: "clerk_gone",
        deletedAt: null,
      });

      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("clerk_gone"),
      );
      errorSpy.mockRestore();
    });

    it("ignores a tombstone older than the maximum Clerk session lifetime", async () => {
      const justPastWindow = new Date(
        Date.now() - MAX_CLERK_SESSION_LIFETIME_MS - 1000,
      );
      mockTombstoneFindFirst.mockResolvedValue({
        providerId: "clerk_gone",
        deletedAt: justPastWindow,
      });

      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(false);
    });

    it("ignores a tombstone exactly at the window boundary (strict comparison)", async () => {
      const exactlyAtWindow = new Date(
        Date.now() - MAX_CLERK_SESSION_LIFETIME_MS,
      );
      mockTombstoneFindFirst.mockResolvedValue({
        providerId: "clerk_gone",
        deletedAt: exactlyAtWindow,
      });

      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(false);
    });

    it("still blocks a tombstone one millisecond inside the window boundary", async () => {
      // The true inside edge: age === MAX - 1. Catches an off-by-one that flips
      // the strict `<` to `<=` on the inside, which a minute of slack would miss.
      const oneMsInsideWindow = new Date(
        Date.now() - (MAX_CLERK_SESSION_LIFETIME_MS - 1),
      );
      mockTombstoneFindFirst.mockResolvedValue({
        providerId: "clerk_gone",
        deletedAt: oneMsInsideWindow,
      });

      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(true);
    });

    it("filters the lookup by the given provider id", async () => {
      mockTombstoneFindFirst.mockResolvedValue(undefined);

      await isProviderTombstoned("clerk_gone");

      expect(
        sameCondition(
          mockTombstoneFindFirst.mock.calls[0][0].where,
          eq(deletionTombstones.providerId, "clerk_gone"),
        ),
      ).toBe(true);
    });

    it("is false when no tombstone row exists", async () => {
      mockTombstoneFindFirst.mockResolvedValue(undefined);

      await expect(isProviderTombstoned("clerk_live")).resolves.toBe(false);
    });
  });

  describe("recordDeletionTombstone", () => {
    it("re-stamps deletedAt on conflict so re-deleting restarts the retention window", async () => {
      await recordDeletionTombstone("clerk_gone");

      expect(mockInsert).toHaveBeenCalledWith(deletionTombstones);
      expect(mockValues).toHaveBeenCalledWith({ providerId: "clerk_gone" });

      // A bare onConflictDoNothing would leave an expired row in place, so a
      // second deletion after the window would go untombstoned. Assert the
      // conflict path targets the provider id and refreshes deletedAt.
      const upsertArgs = mockOnConflictDoUpdate.mock.calls[0][0];
      expect(upsertArgs.target).toBe(deletionTombstones.providerId);
      const renderedSet = dialect.sqlToQuery(upsertArgs.set.deletedAt);
      expect(renderedSet.sql).toContain("now()");
    });

    it("re-arms an expired tombstone so a second deletion blocks again", async () => {
      // The scenario the upsert exists for, driven end-to-end through a shared
      // stored row: first deletion blocks, the window elapses and self-heals,
      // then a second deletion re-stamps deletedAt and blocks again. A regression
      // to onConflictDoNothing leaves the stale row and fails the final assertion.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      let storedDeletedAt = new Date();
      mockTombstoneFindFirst.mockImplementation(async () => ({
        providerId: "clerk_gone",
        deletedAt: storedDeletedAt,
      }));
      mockOnConflictDoUpdate.mockImplementation(async () => {
        storedDeletedAt = new Date();
      });

      await recordDeletionTombstone("clerk_gone");
      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(true);

      vi.advanceTimersByTime(MAX_CLERK_SESSION_LIFETIME_MS + 1000);
      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(false);

      await recordDeletionTombstone("clerk_gone");
      await expect(isProviderTombstoned("clerk_gone")).resolves.toBe(true);

      vi.useRealTimers();
    });
  });
});
