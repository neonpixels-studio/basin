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

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
  query: {
    feeds: {
      findMany: mockFeedsFindMany,
      findFirst: mockFeedsFindFirst,
    },
  },
} as unknown as ReturnType<typeof import("../../../server/utils/db").useDb>;

// assertWithinFeedLimit is the one dependency worth stubbing out (it hits the
// DB independently of the mockDb above, keyed on the ambient useDb() global
// rather than an injected db). feedLimitExceededError/isFeedLimitDbError are
// left real: they're pure and this module's cap-skip messaging and DB-trigger
// translation (see upsertIntegrationFeed) depend on their actual behavior.
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

describe("createYouTubeFeedsForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
    mockGetAccountPlan.mockResolvedValue({
      plan: "pro",
      status: "active",
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });

  it("creates a feed for every subscribed channel, using the subscription title", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
      { channelId: "UC2", title: "Channel Two" },
    ]);

    const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(result).toEqual({ created: 2, skipped: [] });
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "UC1",
      title: "Channel One",
      source: "youtube",
    });
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "UC2",
      title: "Channel Two",
      source: "youtube",
    });
  });

  it("does not check plan/capacity for a paid account (no cap applies)", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
    ]);

    await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(mockGetAccountPlan).toHaveBeenCalledWith(1);
    expect(mockFeedsFindMany).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("upserts on conflict so a reconnect resets sync backoff state without touching the title key", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
    ]);

    await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.any(Array),
      set: expect.objectContaining({
        source: "youtube",
        title: "Channel One",
        nextRetryAt: null,
      }),
    });
  });

  it("does nothing when the account has no subscriptions", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([]);

    const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(result).toEqual({ created: 0, skipped: [] });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockGetAccountPlan).not.toHaveBeenCalled();
  });

  it("propagates a failure to list subscriptions instead of silently creating nothing", async () => {
    mockFetchYouTubeSubscriptions.mockRejectedValue(
      new Error("Subscriptions API error: 500"),
    );

    await expect(
      createYouTubeFeedsForUser(mockDb, 1, "token-abc"),
    ).rejects.toThrow("Subscriptions API error: 500");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  describe("on a Free plan", () => {
    beforeEach(() => {
      mockGetAccountPlan.mockResolvedValue({
        plan: "free",
        status: "none",
        trialEnd: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
      mockFeedsFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue([{ value: 0 }]);
    });

    it("resolves capacity once (not per channel) from the current feed count", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      mockCount.mockResolvedValue([{ value: 8 }]);

      const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

      expect(result).toEqual({ created: 2, skipped: [] });
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

      const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

      expect(result.created).toBe(1);
      expect(result.skipped).toEqual([
        {
          channelId: "UC2",
          reason: `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`,
        },
        {
          channelId: "UC3",
          reason: `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`,
        },
      ]);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("does not count a channel already followed as a previous connect against the remaining budget", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      // No slots left, but UC1 already has a feed row from a prior connect —
      // it should still be reconciled (backoff reset), not skipped.
      mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT }]);
      mockFeedsFindMany.mockResolvedValue([{ url: "UC1" }]);

      const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

      expect(result.created).toBe(1);
      expect(result.skipped).toEqual([
        {
          channelId: "UC2",
          reason: `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`,
        },
      ]);
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ url: "UC1" }),
      );
    });

    it("translates a raced DB-trigger cap rejection into the same clean 403 message", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
      ]);
      mockCount.mockResolvedValue([{ value: 0 }]);
      mockOnConflictDoUpdate.mockRejectedValue(makeCapDbError());

      const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

      expect(result.created).toBe(0);
      expect(result.skipped).toEqual([
        {
          channelId: "UC1",
          reason: `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`,
        },
      ]);
    });

    it("still inserts the remaining channels when one insert fails for an unrelated reason", async () => {
      mockFetchYouTubeSubscriptions.mockResolvedValue([
        { channelId: "UC1", title: "Channel One" },
        { channelId: "UC2", title: "Channel Two" },
      ]);
      mockCount.mockResolvedValue([{ value: 0 }]);
      mockOnConflictDoUpdate
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValueOnce(undefined);

      const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

      expect(result.created).toBe(1);
      expect(result.skipped).toEqual([
        { channelId: "UC1", reason: "connection reset" },
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
    await createBlueskyFeedForUser(mockDb, 1, "you.bsky.social");

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
      createBlueskyFeedForUser(mockDb, 1, "you.bsky.social"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("updates the existing bluesky feed in place on reconnect instead of inserting a second row", async () => {
    mockFeedsFindFirst.mockResolvedValue({ id: 42 });

    await createBlueskyFeedForUser(mockDb, 1, "you.bsky.social");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockAssertWithinFeedLimit).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bsky.app/profile/you.bsky.social",
        title: "you.bsky.social",
      }),
    );
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("updates the same row (not a new one) when the handle has changed since last connect", async () => {
    mockFeedsFindFirst.mockResolvedValue({ id: 42 });

    await createBlueskyFeedForUser(mockDb, 1, "new-handle.bsky.social");

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bsky.app/profile/new-handle.bsky.social",
        title: "new-handle.bsky.social",
      }),
    );
  });
});
