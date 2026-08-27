import { ErrorDoNotRetry } from "@netlify/async-workloads";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockUpdateReturning,
  mockFindFirst,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockFindFirst: vi.fn(),
}));

vi.mock("../../../netlify/functions/db", () => ({
  createDb: vi.fn(() => ({
    update: mockUpdate,
    query: { feeds: { findFirst: mockFindFirst } },
  })),
}));

import {
  providerForSourceType,
  IntegrationAuthError,
  ServerConfigError,
  persistPermanentSyncFailure,
  persistSyncSuccess,
} from "../../../netlify/functions/syncFailureTracking";

// Renders a drizzle SQL fragment to its parameterised text so a test can assert
// the actual SQL emitted (e.g. an atomic `+ 1` increment) rather than trusting
// an opaque object.
function renderSql(fragment: SQL): string {
  return new PgDialect().sqlToQuery(fragment).sql;
}

describe("syncFailureTracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    // where() must satisfy two chains: the atomic-increment write ends in
    // `.returning()`, while every other write is awaited directly. Returning an
    // object that carries `.returning` covers the first; awaiting that object
    // resolves to it and the value is ignored, covering the rest.
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    // Default: the increment lands and the feed is now at one consecutive
    // failure. Individual tests override the returned count.
    mockUpdateReturning.mockResolvedValue([{ consecutiveFailures: 1 }]);
  });

  // Restore real timers even when an assertion throws, so a single failure in a
  // fake-timer test can't cascade into every later test running on a frozen clock.
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("providerForSourceType()", () => {
    it("maps youtube and bluesky source types to their provider", () => {
      expect(providerForSourceType("youtube")).toBe("youtube");
      expect(providerForSourceType("bluesky")).toBe("bluesky");
    });

    it("returns null for rss, podcast, and unknown source types", () => {
      expect(providerForSourceType("rss")).toBeNull();
      expect(providerForSourceType("podcast")).toBeNull();
      expect(providerForSourceType("twitter")).toBeNull();
    });
  });

  describe("persistPermanentSyncFailure()", () => {
    it("persists the error status and message on the feed for a plain ErrorDoNotRetry", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      expect(mockUpdateSet).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          syncStatus: "error",
          syncError: "Feed unreachable",
          syncFailedAt: expect.any(Date),
        }),
      );
    });

    it("bumps consecutiveFailures with a single atomic SQL increment and no prior read", async () => {
      // The whole point of the issue: the counter must advance via an atomic
      // `consecutive_failures + 1` UPDATE, not a read-then-write, so concurrent
      // failures can't race on a stale read and stall the backoff.
      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      const [incrementSet] = mockUpdateSet.mock.calls[0];
      expect(incrementSet.consecutiveFailures).toBeInstanceOf(SQL);
      expect(renderSql(incrementSet.consecutiveFailures)).toContain(
        '"feeds"."consecutive_failures" + 1',
      );

      // No SELECT: the count is read back via RETURNING, never a prior query.
      expect(mockFindFirst).not.toHaveBeenCalled();
      expect(mockUpdateReturning).toHaveBeenCalledTimes(1);
    });

    it("scopes both failure writes to the feed's (id, userId)", async () => {
      // The scope is a security boundary: a feedId belonging to a different user
      // than the event claims must never be written. Assert both the increment
      // and the nextRetryAt write carry the (id, userId) predicate.
      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      expect(mockUpdateWhere).toHaveBeenCalledTimes(2);
      for (const [whereClause] of mockUpdateWhere.mock.calls) {
        const { sql, params } = new PgDialect().sqlToQuery(whereClause);
        expect(sql).toContain('"feeds"."id" = ');
        expect(sql).toContain('"feeds"."user_id" = ');
        expect(params).toEqual([42, 1]);
      }
    });

    it("computes nextRetryAt from the RETURNING count for a first failure", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      // The atomic increment reports the feed is now at one consecutive failure.
      mockUpdateReturning.mockResolvedValue([{ consecutiveFailures: 1 }]);

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      // First failure: retry pushed out one base interval (15 minutes) from the
      // failure time. nextRetryAt is the second write.
      expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
        nextRetryAt: new Date("2026-01-01T00:15:00.000Z"),
      });
    });

    it("escalates the backoff from the RETURNING count, not a pre-read value", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      // The DB increment lands this feed's 4th consecutive failure.
      mockUpdateReturning.mockResolvedValue([{ consecutiveFailures: 4 }]);

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed still unreachable"),
      );

      // 4th failure: 2^3 * 15min = 2 hours from now.
      expect(mockUpdateSet).toHaveBeenNthCalledWith(2, {
        nextRetryAt: new Date("2026-01-01T02:00:00.000Z"),
      });
    });

    it("no-ops the nextRetryAt write when the feed row no longer exists", async () => {
      // A feed deleted between the sync attempt and this write matches no rows,
      // so RETURNING is empty and the derived nextRetryAt write must be skipped.
      mockUpdateReturning.mockResolvedValue([]);

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      // Only the increment ran; no second (nextRetryAt) update.
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    });

    it("does not touch integrations for a feed-only failure (not IntegrationAuthError)", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Source mismatch for feed 42"),
      );

      // Two updates — the atomic increment and the derived nextRetryAt — both on
      // the feed. No integration lookup/update, even though this is a permanent
      // failure: a source mismatch or exhausted retries says nothing about
      // whether the connected account is broken.
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it("also persists the error status on the backing integration for an IntegrationAuthError", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new IntegrationAuthError("youtube", "Re-connect your YouTube account."),
      );

      // Two feed writes (increment + nextRetryAt) then the integration write.
      expect(mockUpdate).toHaveBeenCalledTimes(3);
      expect(mockUpdateSet).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          syncStatus: "error",
          syncError: "Re-connect your YouTube account.",
          syncFailedAt: expect.any(Date),
        }),
      );
    });

    it("uses the provider carried on the IntegrationAuthError, not the source type", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new IntegrationAuthError("bluesky", "Reconnect Bluesky in Settings."),
      );

      // Two feed writes plus the integration write.
      expect(mockUpdate).toHaveBeenCalledTimes(3);
    });

    it("IntegrationAuthError is an instance of ErrorDoNotRetry", () => {
      const error = new IntegrationAuthError("youtube", "expired");
      expect(error).toBeInstanceOf(ErrorDoNotRetry);
    });

    it("does not touch the feed or the integration for a ServerConfigError", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new ServerConfigError(
          "NUXT_GOOGLE_CLIENT_ID and NUXT_GOOGLE_CLIENT_SECRET must be set to refresh YouTube tokens.",
        ),
      );

      // A server misconfiguration is not the user's fault and must never be
      // persisted as a feed/integration failure for them to see.
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("persistSyncSuccess()", () => {
    it("clears the feed's failure state and sets lastFetched", async () => {
      const syncedAt = new Date("2024-06-01T00:00:00Z");
      await persistSyncSuccess(1, 42, "rss", syncedAt);

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          lastFetched: syncedAt,
          syncStatus: "ok",
          syncError: null,
          syncFailedAt: null,
          // A successful sync clears the backoff so the feed returns to the
          // normal cadence immediately.
          consecutiveFailures: 0,
          nextRetryAt: null,
        }),
      );
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it("also clears the backing integration's failure state for youtube", async () => {
      const syncedAt = new Date("2024-06-01T00:00:00Z");
      await persistSyncSuccess(1, 42, "youtube", syncedAt);

      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdateSet).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          syncStatus: "ok",
          syncError: null,
          syncFailedAt: null,
        }),
      );
    });
  });
});
