import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { deletionTombstones } from "../../../server/db/schema";

const mockTombstoneFindFirst = vi.fn();
const mockOnConflictDoNothing = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();

vi.stubGlobal("useDb", () => ({
  query: { deletionTombstones: { findFirst: mockTombstoneFindFirst } },
  insert: mockInsert,
}));

import {
  isProviderTombstoned,
  recordDeletionTombstone,
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
      onConflictDoNothing: mockOnConflictDoNothing,
    });
    mockOnConflictDoNothing.mockResolvedValue(undefined);
  });

  describe("isProviderTombstoned", () => {
    it("is true when a tombstone row exists for the provider id", async () => {
      mockTombstoneFindFirst.mockResolvedValue({
        providerId: "clerk_gone",
        deletedAt: null,
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
    it("inserts the provider id with onConflictDoNothing so a repeat deletion is a no-op", async () => {
      await recordDeletionTombstone("clerk_gone");

      expect(mockInsert).toHaveBeenCalledWith(deletionTombstones);
      expect(mockValues).toHaveBeenCalledWith({ providerId: "clerk_gone" });
      expect(mockOnConflictDoNothing).toHaveBeenCalled();
    });
  });
});
