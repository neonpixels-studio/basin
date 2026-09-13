import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();
const mockFeedsFindMany = vi.fn();
const mockFeedsFindFirst = vi.fn();
const mockCount = vi.fn();
const mockSelectWhere = vi.fn(() => mockCount());
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));
const mockUpdateWhere = vi.fn();
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

vi.stubGlobal("useDb", () => ({
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
  query: {
    feeds: {
      findMany: mockFeedsFindMany,
      findFirst: mockFeedsFindFirst,
    },
  },
}));

// assertWithinFeedLimit is the one dependency worth stubbing out (it's
// already unit-tested on its own in feedCreationLimit.test.ts).
// feedLimitExceededError/isFeedLimitDbError are left real: they're pure and
// this module's cap-skip messaging and DB-trigger translation (see
// upsertIntegrationFeed) depend on their actual behavior.
vi.mock("../../../server/utils/feedLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/utils/feedLimit")>();
  return { ...actual, assertWithinFeedLimit: vi.fn() };
});

vi.mock("../../../server/utils/subscriptions", () => ({
  getAccountPlan: vi.fn(),
}));

vi.mock("../../../server/utils/youtubeAdapter", () => ({
  fetchYouTubeSubscriptions: vi.fn(),
}));

import { DrizzleQueryError } from "drizzle-orm";
import {
  createYouTubeFeedsForUser,
  createBlueskyFeedForUser,
} from "../../../server/utils/integrationFeedCreation";
import {
  assertWithinFeedLimit,
  FEED_LIMIT_DB_ERROR_MARKER,
  FEED_LIMIT_SQLSTATE,
} from "../../../server/utils/feedLimit";
import { getAccountPlan } from "../../../server/utils/subscriptions";
import { fetchYouTubeSubscriptions } from "../../../server/utils/youtubeAdapter";
import { FREE_PLAN_FEED_LIMIT } from "../../../server/utils/planLimits";

const mockAssertWithinFeedLimit = vi.mocked(assertWithinFeedLimit);
const mockGetAccountPlan = vi.mocked(getAccountPlan);
const mockFetchYouTubeSubscriptions = vi.mocked(fetchYouTubeSubscriptions);

const PRO_PLAN = {
  plan: "pro" as const,
  status: "active",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

const FREE_PLAN = {
  plan: "free" as const,
  status: "none",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

// Mirrors how the real Postgres cap trigger (migration
// 0011_enforce_source_cap.sql) surfaces through drizzle's neon-http driver:
// a DrizzleQueryError wrapping the raw Postgres error carrying the SQLSTATE
// and marker text. See isFeedLimitDbError in feedLimit.ts.
function makeCapDbError(): DrizzleQueryError {
  const pgError = Object.assign(
    new Error(`insert violates constraint: ${FEED_LIMIT_DB_ERROR_MARKER}`),
    { code: FEED_LIMIT_SQLSTATE },
  );
  return new DrizzleQueryError("insert into feeds ...", [], pgError);
}

const CAP_MESSAGE = `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`;

describe("createYouTubeFeedsForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
    mockGetAccountPlan.mockResolvedValue(PRO_PLAN);
  });

  it("creates a feed for every subscribed channel in a single batched insert, using the subscription title", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
      { channelId: "UC2", title: "Channel Two" },
    ]);

    const result = await createYouTubeFeedsForUser(1, "token-abc");

    expect(result).toEqual({ upserted: 2, skipped: [] });
    // One statement for the whole chunk, not one per channel.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith([
      { userId: 1, url: "UC1", title: "Channel One", source: "youtube" },
      { userId: 1, url: "UC2", title: "Channel Two", source: "youtube" },
    ]);
  });

  it("dedupes a channel returned twice (a page-boundary shift) before inserting", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
      { channelId: "UC1", title: "Channel One" },
    ]);

    const result = await createYouTubeFeedsForUser(1, "token-abc");

    expect(result).toEqual({ upserted: 1, skipped: [] });
    expect(mockValues).toHaveBeenCalledWith([
      { userId: 1, url: "UC1", title: "Channel One", source: "youtube" },
    ]);
  });

  it("normalizes an empty subscription title to null instead of writing a blank source name", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "" },
    ]);

    await createYouTubeFeedsForUser(1, "token-abc");

    expect(mockValues).toHaveBeenCalledWith([
      { userId: 1, url: "UC1", title: null, source: "youtube" },
    ]);
  });

  it("does not check plan/capacity for a paid account (no cap applies)", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
    ]);

    await createYouTubeFeedsForUser(1, "token-abc");

    expect(mockGetAccountPlan).toHaveBeenCalledWith(1);
    expect(mockFeedsFindMany).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("upserts on conflict so a reconnect resets sync backoff state", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
    ]);

    await createYouTubeFeedsForUser(1, "token-abc");

    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.any(Array),
      set: expect.objectContaining({ nextRetryAt: null }),
    });
  });

  it("does nothing when the account has no subscriptions", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([]);

    const result = await createYouTubeFeedsForUser(1, "token-abc");

    expect(result).toEqual({ upserted: 0, skipped: [] });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockGetAccountPlan).not.toHaveBeenCalled();
  });

  it("propagates a failure to list subscriptions instead of silently creating nothing", async () => {
    mockFetchYouTubeSubscriptions.mockRejectedValue(
      new Error("Subscriptions API error: 500"),
    );

    await expect(createYouTubeFeedsForUser(1, "token-abc")).rejects.toThrow(
      "Subscriptions API error: 500",
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("splits work across multiple chunks for a large subscription list", async () => {
    const subscriptions = Array.from({ length: 120 }, (_, index) => ({
      channelId: `UC${index}`,
      title: `Channel ${index}`,
    }));
    mockFetchYouTubeSubscriptions.mockResolvedValue(subscriptions);

    const result = await createYouTubeFeedsForUser(1, "token-abc");

    expect(result.upserted).toBe(120);
    // Chunk size is 50, so 120 channels need 3 batched statements.
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });

  describe("on a Free plan", () => {
    beforeEach(() => {
      mockGetAccountPlan.mockResolvedValue(FREE_PLAN);
      mockFeedsFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue([{ value: 0 }]);
    });

    it("resolves capacity once (not per channel) from the current feed count", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      mockCount.mockResolvedValue([{ value: 8 }]);

      const result = await createYouTubeFeedsForUser(1, "token-abc");

      expect(result).toEqual({ upserted: 2, skipped: [] });
      // One capacity check total, not one per channel.
      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockFeedsFindMany).toHaveBeenCalledTimes(1);
    });

    it("skips channels once the free-plan cap is reached, without a DB call per skip", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
        { channelId: "UC3", title: "Channel Three" },
      ]);
      // 9 existing feeds, cap is FREE_PLAN_FEED_LIMIT — only 1 slot left.
      mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT - 1 }]);

      const result = await createYouTubeFeedsForUser(1, "token-abc");

      expect(result.upserted).toBe(1);
      expect(result.skipped).toEqual([
        { channelId: "UC2", reason: CAP_MESSAGE },
        { channelId: "UC3", reason: CAP_MESSAGE },
      ]);
      expect(mockValues).toHaveBeenCalledWith([
        { userId: 1, url: "UC1", title: "Channel One", source: "youtube" },
      ]);
    });

    it("reconciles an already-followed channel (backoff reset) without spending a cap slot on it", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      // No slots left, but UC1 already has a feed row from a prior connect —
      // it should still be reconciled (backoff reset), not skipped, since it
      // isn't consuming a new slot.
      mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT }]);
      mockFeedsFindMany.mockResolvedValue([{ url: "UC1" }]);

      const result = await createYouTubeFeedsForUser(1, "token-abc");

      expect(result.upserted).toBe(1);
      expect(result.skipped).toEqual([
        { channelId: "UC2", reason: CAP_MESSAGE },
      ]);
      expect(mockValues).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ url: "UC1" })]),
      );
    });

    it("translates a raced DB-trigger cap rejection into the same clean 403 message for the whole chunk", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      mockCount.mockResolvedValue([{ value: 0 }]);
      mockOnConflictDoUpdate.mockRejectedValue(makeCapDbError());

      const result = await createYouTubeFeedsForUser(1, "token-abc");

      expect(result.upserted).toBe(0);
      expect(result.skipped).toEqual([
        { channelId: "UC1", reason: CAP_MESSAGE },
        { channelId: "UC2", reason: CAP_MESSAGE },
      ]);
    });

    it("falls back to per-row inserts for the chunk when the batch fails for an unrelated reason", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      mockCount.mockResolvedValue([{ value: 0 }]);
      // The batched attempt fails; the per-row fallback then succeeds for
      // one channel and fails for the other.
      mockOnConflictDoUpdate
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockRejectedValueOnce(new Error("still broken"))
        .mockResolvedValueOnce(undefined);

      const result = await createYouTubeFeedsForUser(1, "token-abc");

      expect(result.upserted).toBe(1);
      expect(result.skipped).toEqual([
        { channelId: "UC1", reason: "still broken" },
      ]);
    });
  });
});

describe("createBlueskyFeedForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
    mockFeedsFindFirst.mockResolvedValue(undefined);
  });

  it("creates exactly one feed for the connected account's timeline on first connect", async () => {
    await createBlueskyFeedForUser(1, "you.bsky.social");

    expect(mockAssertWithinFeedLimit).toHaveBeenCalledWith(
      1,
      "https://bsky.app/profile/you.bsky.social",
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "https://bsky.app/profile/you.bsky.social",
      title: "you.bsky.social",
      source: "bluesky",
    });
  });

  it("propagates a free-plan cap rejection instead of inserting anyway", async () => {
    mockAssertWithinFeedLimit.mockRejectedValue(
      Object.assign(new Error("cap exceeded"), { statusCode: 403 }),
    );

    await expect(
      createBlueskyFeedForUser(1, "you.bsky.social"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("updates the existing bluesky feed in place on reconnect with the same handle, preserving its sync watermark", async () => {
    mockFeedsFindFirst.mockResolvedValue({
      id: 42,
      url: "https://bsky.app/profile/you.bsky.social",
    });

    await createBlueskyFeedForUser(1, "you.bsky.social");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockAssertWithinFeedLimit).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      url: "https://bsky.app/profile/you.bsky.social",
      title: "you.bsky.social",
      syncStatus: "ok",
      syncError: null,
      syncFailedAt: null,
      nextRetryAt: null,
    });
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("resets the sync watermark when the handle (and so the underlying account) has changed", async () => {
    // Otherwise a reconnect to a different Bluesky account inherits the
    // previous account's lastFetched, and everything in the new account's
    // timeline older than that watermark is silently never imported.
    mockFeedsFindFirst.mockResolvedValue({
      id: 42,
      url: "https://bsky.app/profile/old-handle.bsky.social",
    });

    await createBlueskyFeedForUser(1, "new-handle.bsky.social");

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bsky.app/profile/new-handle.bsky.social",
        title: "new-handle.bsky.social",
        lastFetched: null,
      }),
    );
  });
});
