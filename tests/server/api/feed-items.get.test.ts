import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetQuery = vi.fn();
vi.stubGlobal("getQuery", mockGetQuery);

vi.mock("../../../server/utils/feedItems");

import { fetchFeedItems } from "../../../server/utils/feedItems";
import handler from "../../../server/api/feed-items.get";

const mockFetchFeedItems = vi.mocked(fetchFeedItems);

const mockPage = {
  items: [
    {
      id: 1,
      feedId: 10,
      guid: "guid-1",
      type: "article",
      source: "Test Feed",
      handle: "Test Feed",
      time: "2h",
      title: "Test Article",
      url: "https://example.com/article",
      author: null,
      imageUrl: null,
      content: null,
      tags: null,
      publishedAt: null,
      readAt: null,
      starred: false,
      savedAt: null,
      mediaUrl: null,
      mediaDuration: null,
      createdAt: null,
      updatedAt: null,
      unread: true,
      saved: false,
    },
  ],
  total: 1,
  nextOffset: null,
};

describe("GET /api/feed-items", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetQuery.mockReturnValue({});
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("returns paginated feed items for authenticated user", async () => {
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result).toEqual(mockPage);
  });

  it("calls fetchFeedItems with the authenticated user id", async () => {
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 42 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(42, expect.any(Object));
  });

  it("parses limit and offset from query string", async () => {
    mockGetQuery.mockReturnValue({ limit: "20", offset: "40" });
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(1, {
      limit: 20,
      offset: 40,
      filter: undefined,
    });
  });

  it("passes undefined limit and offset when not provided in query", async () => {
    mockGetQuery.mockReturnValue({});
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(1, {
      limit: undefined,
      offset: undefined,
      filter: undefined,
    });
  });

  it("passes undefined for non-numeric limit and offset", async () => {
    mockGetQuery.mockReturnValue({ limit: "abc", offset: "xyz" });
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(1, {
      limit: undefined,
      offset: undefined,
      filter: undefined,
    });
  });

  it("passes undefined for partially-numeric limit and offset", async () => {
    mockGetQuery.mockReturnValue({ limit: "20abc", offset: "40xyz" });
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(1, {
      limit: undefined,
      offset: undefined,
      filter: undefined,
    });
  });

  it("returns nextOffset as null when on the last page", async () => {
    mockFetchFeedItems.mockResolvedValue({ ...mockPage, nextOffset: null });
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result.nextOffset).toBeNull();
  });

  it("returns nextOffset as a number when more pages exist", async () => {
    mockFetchFeedItems.mockResolvedValue({ ...mockPage, nextOffset: 50 });
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result.nextOffset).toBe(50);
  });

  it("returns an empty items array when user has no feed items", async () => {
    mockFetchFeedItems.mockResolvedValue({
      items: [],
      total: 0,
      nextOffset: null,
    });
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result.items).toEqual([]);
  });

  it("passes a valid dashboard filter through to fetchFeedItems", async () => {
    mockGetQuery.mockReturnValue({ filter: "saved" });
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(1, {
      limit: undefined,
      offset: undefined,
      filter: "saved",
    });
  });

  it("treats the 'all' filter as no restriction", async () => {
    mockGetQuery.mockReturnValue({ filter: "all" });
    mockFetchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockFetchFeedItems).toHaveBeenCalledWith(1, {
      limit: undefined,
      offset: undefined,
      filter: undefined,
    });
  });

  it("throws 400 for an unknown filter", async () => {
    mockGetQuery.mockReturnValue({ filter: "bogus" });
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });
});
