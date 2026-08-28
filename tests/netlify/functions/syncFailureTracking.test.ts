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

// Renders a drizzle SQL fragment to its parameterised text and params so a test
// can assert the actual SQL emitted (e.g. an atomic `+ 1` increment) or the
// bound values, rather than trusting an opaque object.
function renderSql(fragment: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(fragment);
}

// A where() result that is both awaitable (writes that await it directly) and
// carries `.returning()` (the atomic-increment write), so one stub satisfies
// every update chain.
function updateChainResult() {
  return Object.assign(Promise.resolve(undefined), {
    returning: mockUpdateReturning,
  });
}

// Locates the UPDATE that targeted the integrations table by its where clause,
// not by dispatch index. The feed increment and the integration write carry an
// identical `set` shape and are dispatched concurrently, so index-based
// selection is brittle. set() and where() are called synchronously in one
// chain, so the returned index aligns the two mocks for a payload assertion.
function integrationCallIndex() {
  return mockUpdateWhere.mock.calls.findIndex(([whereClause]) =>
    renderSql(whereClause).sql.includes('"integrations"."provider"'),
  );
}

describe("syncFailureTracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    // where() must satisfy two chains: the atomic-increment write ends in
    // `.returning()`, while every other write is awaited directly. One thenable
    // that also carries `.returning` covers both.
    mockUpdateWhere.mockReturnValue(updateChainResult());
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
      expect(renderSql(incrementSet.consecutiveFailures).sql).toContain(
        '"feeds"."consecutive_failures" + 1',
      );

      // nextRetryAt must NOT ride along on the increment: computing it here would
      // need a pre-read count — the exact read-then-write this change removes. It
      // belongs on the second, guarded write only. Assert membership (not key
      // order, which has no behavioral meaning) so re-adding it regresses this.
      expect(incrementSet).not.toHaveProperty("nextRetryAt");
      expect(Object.keys(incrementSet).sort()).toEqual([
        "consecutiveFailures",
        "syncError",
        "syncFailedAt",
        "syncStatus",
      ]);

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
        const { sql } = renderSql(whereClause);
        expect(sql).toContain('"feeds"."id" = ');
        expect(sql).toContain('"feeds"."user_id" = ');
      }

      // The increment is scoped by exactly (id, userId).
      const { params: incrementParams } = renderSql(
        mockUpdateWhere.mock.calls[0][0],
      );
      expect(incrementParams).toEqual([42, 1]);
    });

    it("guards the nextRetryAt write with this call's (syncFailedAt, consecutiveFailures) so a stale writer no-ops", async () => {
      // The neon-http driver has no interactive transactions, so a slow
      // concurrent (or stalled-then-resumed) failure must not clobber a fresher
      // nextRetryAt. The second write carries BOTH predicates: the RETURNING
      // count distinguishes two failures that stamped the same millisecond
      // (timestamp alone can't), and the timestamp rules out an ABA where a
      // reset-to-zero then a fresh failure resurrects an old count value.
      mockUpdateReturning.mockResolvedValue([{ consecutiveFailures: 2 }]);

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      const stampedFailedAt = mockUpdateSet.mock.calls[0][0].syncFailedAt;
      const { sql, params } = renderSql(mockUpdateWhere.mock.calls[1][0]);
      expect(sql).toContain('"feeds"."sync_failed_at" = ');
      expect(sql).toContain('"feeds"."consecutive_failures" = ');
      // (id, userId, timestamp guard, count guard) — the exact pair write 1
      // wrote (the dialect renders the Date param as its ISO string).
      expect(params).toEqual([42, 1, stampedFailedAt.toISOString(), 2]);
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

    it("still records the integration failure when the feed row is gone but the error is an IntegrationAuthError", async () => {
      // A deleted feed skips the feed writes, but a broken connection still
      // needs flagging on the integration so SettingsConnections can surface it
      // — the account is broken regardless of whether this one feed survives.
      mockUpdateReturning.mockResolvedValue([]);

      await persistPermanentSyncFailure(
        1,
        42,
        new IntegrationAuthError("youtube", "Re-connect your YouTube account."),
      );

      // Feed increment (no-op RETURNING) + the integration write; no feed
      // nextRetryAt write.
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdateSet).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          syncStatus: "error",
          syncError: "Re-connect your YouTube account.",
        }),
      );
    });

    it("propagates a failure of the nextRetryAt write instead of swallowing it", async () => {
      // Without an interactive transaction the two writes can't be atomic, so a
      // failed nextRetryAt write must surface (fail loud) rather than be
      // swallowed into a half-written, silently-ungated row. The increment write
      // lands; the backoff write (the only one carrying the count guard) rejects.
      mockUpdateWhere.mockImplementation((whereClause) =>
        renderSql(whereClause).sql.includes('"feeds"."consecutive_failures" = ')
          ? Promise.reject(new Error("connection reset"))
          : updateChainResult(),
      );

      await expect(
        persistPermanentSyncFailure(
          1,
          42,
          new ErrorDoNotRetry("Feed unreachable"),
        ),
      ).rejects.toThrow("connection reset");
    });

    it("records the integration flag even when the backoff write fails", async () => {
      // The backoff write is a separate statement that can fail on its own. It's
      // dispatched independently of the integration write, so an
      // IntegrationAuthError still marks the connection as needing reconnect even
      // when the backoff dies — the flag is the user-visible signal and must not
      // ride on the scheduling optimization. Reject the backoff write by its
      // clause (the only one carrying the count guard), so the test holds
      // regardless of dispatch order.
      mockUpdateWhere.mockImplementation((whereClause) =>
        renderSql(whereClause).sql.includes('"feeds"."consecutive_failures" = ')
          ? Promise.reject(new Error("connection reset"))
          : updateChainResult(),
      );

      await expect(
        persistPermanentSyncFailure(
          1,
          42,
          new IntegrationAuthError(
            "youtube",
            "Re-connect your YouTube account.",
          ),
        ),
      ).rejects.toThrow("connection reset");

      // Assert the integration write's payload, not just that it dispatched:
      // select it by target table, then read the aligned set() call — the
      // increment carries the same set shape, so an unindexed match is vacuous.
      const index = integrationCallIndex();
      expect(index).toBeGreaterThanOrEqual(0);
      expect(mockUpdateSet.mock.calls[index][0]).toEqual(
        expect.objectContaining({
          syncStatus: "error",
          syncError: "Re-connect your YouTube account.",
        }),
      );
    });

    it("still flags the integration when the failure increment write rejects", async () => {
      // The increment is the feed's own write; the integration reconnect flag is
      // an independent row and must not be suppressed by the increment failing.
      // Dispatched together, so a rejected increment still lets the flag land.
      mockUpdateReturning.mockRejectedValueOnce(new Error("connection reset"));

      await expect(
        persistPermanentSyncFailure(
          1,
          42,
          new IntegrationAuthError(
            "youtube",
            "Re-connect your YouTube account.",
          ),
        ),
      ).rejects.toThrow("connection reset");

      expect(integrationCallIndex()).toBeGreaterThanOrEqual(0);
    });

    it("throws the first rejection and logs the rest when both writes fail", async () => {
      // Both independent writes fail. The thrown error must surface one failure
      // (fail loud), and the other must be logged with the feed/user, not
      // silently swallowed — that log is its only record.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Feed write (the increment's RETURNING) fails; integration write fails too.
      mockUpdateReturning.mockRejectedValueOnce(new Error("feed write down"));
      mockUpdateWhere.mockImplementation((whereClause) =>
        renderSql(whereClause).sql.includes('"integrations"."provider"')
          ? Promise.reject(new Error("integration write down"))
          : updateChainResult(),
      );

      await expect(
        persistPermanentSyncFailure(
          1,
          42,
          new IntegrationAuthError(
            "youtube",
            "Re-connect your YouTube account.",
          ),
        ),
      ).rejects.toThrow("feed write down");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("feed 42 (user 1)"),
        expect.objectContaining({ message: "integration write down" }),
      );
      errorSpy.mockRestore();
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

      // Three writes: the atomic increment (feed), plus the integration reconnect
      // flag and the backoff dispatched together. Select the integration write by
      // its target table rather than dispatch index — the increment carries an
      // identical set shape, so the where clause is what proves the integrations
      // row was written.
      expect(mockUpdate).toHaveBeenCalledTimes(3);
      const index = integrationCallIndex();
      expect(index).toBeGreaterThanOrEqual(0);
      expect(mockUpdateSet.mock.calls[index][0]).toEqual(
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
