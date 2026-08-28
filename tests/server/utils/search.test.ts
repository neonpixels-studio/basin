import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
}));

import {
  searchFeedItems,
  SEARCH_RESULT_LIMIT,
} from "../../../server/utils/search";

const mockRow = {
  id: 1,
  feedId: 10,
  feedSource: "rss",
  feedTitle: "Test Feed",
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Article content about testing",
  tags: ["test"],
  publishedAt: null,
  readAt: null,
  starred: false,
  savedAt: null,
  createdAt: null,
  updatedAt: null,
};

// Expected result after the mapping step strips feedSource/feedTitle and adds type/source/time.
const expectedResult = {
  id: 1,
  feedId: 10,
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Article content about testing",
  tags: ["test"],
  publishedAt: null,
  readAt: null,
  starred: false,
  savedAt: null,
  createdAt: null,
  updatedAt: null,
  type: "article",
  source: "Test Feed",
  time: "",
};

describe("searchFeedItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  it("returns matching feed items for a given user and query", async () => {
    mockLimit.mockResolvedValue([mockRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results).toEqual([expectedResult]);
  });

  it("includes author and imageUrl in results", async () => {
    mockLimit.mockResolvedValue([mockRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].author).toBe("Jane Doe");
    expect(results[0].imageUrl).toBe("https://example.com/image.jpg");
  });

  it("returns null author and imageUrl when not set", async () => {
    const noAuthorRow = { ...mockRow, author: null, imageUrl: null };
    mockLimit.mockResolvedValue([noAuthorRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].author).toBeNull();
    expect(results[0].imageUrl).toBeNull();
  });

  it("maps feedSource to the correct item type", async () => {
    const podcastRow = { ...mockRow, feedSource: "podcast" };
    mockLimit.mockResolvedValue([podcastRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].type).toBe("podcast");
  });

  it("falls back to feedSource when no type mapping exists", async () => {
    const unknownRow = { ...mockRow, feedSource: "newsletter" };
    mockLimit.mockResolvedValue([unknownRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].type).toBe("newsletter");
  });

  it("uses feedTitle as source when present", async () => {
    mockLimit.mockResolvedValue([mockRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("Test Feed");
  });

  it("falls back to feedSource when feedTitle is null", async () => {
    const noTitleRow = { ...mockRow, feedTitle: null };
    mockLimit.mockResolvedValue([noTitleRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("rss");
  });

  it("falls back to feedSource when feedTitle is an empty string", async () => {
    const emptyTitleRow = { ...mockRow, feedTitle: "" };
    mockLimit.mockResolvedValue([emptyTitleRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("rss");
  });

  it("falls back to feedSource when feedTitle is only whitespace", async () => {
    const whitespaceTitleRow = { ...mockRow, feedTitle: "   " };
    mockLimit.mockResolvedValue([whitespaceTitleRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("rss");
  });

  it("returns an empty array when there are no matches", async () => {
    mockLimit.mockResolvedValue([]);

    const results = await searchFeedItems(1, "nonexistent");

    expect(results).toEqual([]);
  });

  it("applies the result limit", async () => {
    mockLimit.mockResolvedValue([]);

    await searchFeedItems(1, "anything");

    expect(mockLimit).toHaveBeenCalledWith(SEARCH_RESULT_LIMIT);
  });

  it("calls select, from, innerJoin, where, orderBy, and limit in order", async () => {
    await searchFeedItems(42, "query");

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });
});
