import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/utils/feedItems");

import { fetchFeedItemCounts } from "../../../server/utils/feedItems";
import handler from "../../../server/api/feed-item-counts.get";

const mockFetchFeedItemCounts = vi.mocked(fetchFeedItemCounts);

const mockCounts = {
  all: 12,
  saved: 4,
  starred: 3,
  article: 6,
  podcast: 2,
  video: 2,
  tweet: 2,
};

describe("GET /api/feed-item-counts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("returns whole-account filter counts for the authenticated user", async () => {
    mockFetchFeedItemCounts.mockResolvedValue(mockCounts);
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result).toEqual(mockCounts);
  });

  it("calls fetchFeedItemCounts with the authenticated user id", async () => {
    mockFetchFeedItemCounts.mockResolvedValue(mockCounts);
    const event = { context: { user: { id: 42 } } };
    await handler(event);
    expect(mockFetchFeedItemCounts).toHaveBeenCalledWith(42);
  });
});
