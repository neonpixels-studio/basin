import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();
const mockDb = { insert: mockInsert } as unknown as ReturnType<
  typeof import("../../../server/utils/db").useDb
>;

vi.mock("../../../server/utils/feedLimit", () => ({
  assertWithinFeedLimit: vi.fn(),
}));

vi.mock("../../../server/utils/youtubeAdapter", () => ({
  fetchSubscriptionChannelIds: vi.fn(),
}));

import {
  createYouTubeFeedsForUser,
  createBlueskyFeedForUser,
} from "../../../server/utils/integrationFeedCreation";
import { assertWithinFeedLimit } from "../../../server/utils/feedLimit";
import { fetchSubscriptionChannelIds } from "../../../server/utils/youtubeAdapter";

const mockAssertWithinFeedLimit = vi.mocked(assertWithinFeedLimit);
const mockFetchSubscriptionChannelIds = vi.mocked(fetchSubscriptionChannelIds);

describe("createYouTubeFeedsForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
  });

  it("creates a feed for every subscribed channel", async () => {
    mockFetchSubscriptionChannelIds.mockResolvedValue(["UC1", "UC2"]);

    const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(result).toEqual({ created: 2, skipped: [] });
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "UC1",
      title: null,
      source: "youtube",
    });
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "UC2",
      title: null,
      source: "youtube",
    });
  });

  it("upserts on conflict so a reconnect resets sync backoff state", async () => {
    mockFetchSubscriptionChannelIds.mockResolvedValue(["UC1"]);

    await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          source: "youtube",
          title: null,
          nextRetryAt: null,
        }),
      }),
    );
  });

  it("does nothing when the account has no subscriptions", async () => {
    mockFetchSubscriptionChannelIds.mockResolvedValue([]);

    const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(result).toEqual({ created: 0, skipped: [] });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("skips a channel that hits the free-plan feed cap without aborting the rest", async () => {
    mockFetchSubscriptionChannelIds.mockResolvedValue(["UC1", "UC2", "UC3"]);
    mockAssertWithinFeedLimit.mockImplementation(async (_userId, url) => {
      if (url === "UC2") {
        throw Object.assign(new Error("cap exceeded"), {
          statusCode: 403,
          statusMessage: "Free plan is limited to 10 sources",
        });
      }
    });

    const result = await createYouTubeFeedsForUser(mockDb, 1, "token-abc");

    expect(result.created).toBe(2);
    expect(result.skipped).toEqual([
      { channelId: "UC2", reason: "Free plan is limited to 10 sources" },
    ]);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("propagates a failure to list subscriptions instead of silently creating nothing", async () => {
    mockFetchSubscriptionChannelIds.mockRejectedValue(
      new Error("Subscriptions API error: 500"),
    );

    await expect(
      createYouTubeFeedsForUser(mockDb, 1, "token-abc"),
    ).rejects.toThrow("Subscriptions API error: 500");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("createBlueskyFeedForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
  });

  it("creates exactly one feed for the connected account's timeline", async () => {
    await createBlueskyFeedForUser(mockDb, 1, "you.bsky.social");

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "https://bsky.app/profile/you.bsky.social",
      title: "you.bsky.social",
      source: "bluesky",
    });
  });

  it("checks the free-plan feed cap before inserting", async () => {
    await createBlueskyFeedForUser(mockDb, 1, "you.bsky.social");

    expect(mockAssertWithinFeedLimit).toHaveBeenCalledWith(
      1,
      "https://bsky.app/profile/you.bsky.social",
    );
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
});
