import { ErrorDoNotRetry } from "@netlify/async-workloads";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockUpdate, mockUpdateSet, mockUpdateWhere, mockFindFirst } =
  vi.hoisted(() => ({
    mockUpdate: vi.fn(),
    mockUpdateSet: vi.fn(),
    mockUpdateWhere: vi.fn(),
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

describe("syncFailureTracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
    // Default: the feed has no prior failures on record.
    mockFindFirst.mockResolvedValue({ consecutiveFailures: 0 });
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

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          syncStatus: "error",
          syncError: "Feed unreachable",
          syncFailedAt: expect.any(Date),
        }),
      );
    });

    it("advances the backoff to the first failure and sets nextRetryAt", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      // First failure: count becomes 1 and the retry is pushed out one base
      // interval (15 minutes) from the failure time.
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveFailures: 1,
          nextRetryAt: new Date("2026-01-01T00:15:00.000Z"),
        }),
      );
    });

    it("escalates the backoff from the feed's existing consecutive-failure count", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      // Feed has already failed 3 times in a row; this is the 4th.
      mockFindFirst.mockResolvedValue({ consecutiveFailures: 3 });

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed still unreachable"),
      );

      // 4th failure: 2^3 * 15min = 2 hours from now.
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveFailures: 4,
          nextRetryAt: new Date("2026-01-01T02:00:00.000Z"),
        }),
      );
    });

    it("treats a missing feed row as zero prior failures", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      mockFindFirst.mockResolvedValue(undefined);

      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Feed unreachable"),
      );

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveFailures: 1,
          nextRetryAt: new Date("2026-01-01T00:15:00.000Z"),
        }),
      );
    });

    it("does not touch integrations for a feed-only failure (not IntegrationAuthError)", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new ErrorDoNotRetry("Source mismatch for feed 42"),
      );

      // Only one update call — the feed. No integration lookup/update, even
      // though this is a permanent failure: a source mismatch or exhausted
      // retries says nothing about whether the connected account is broken.
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it("also persists the error status on the backing integration for an IntegrationAuthError", async () => {
      await persistPermanentSyncFailure(
        1,
        42,
        new IntegrationAuthError("youtube", "Re-connect your YouTube account."),
      );

      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdateSet).toHaveBeenNthCalledWith(
        2,
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

      expect(mockUpdate).toHaveBeenCalledTimes(2);
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
