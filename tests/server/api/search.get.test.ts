import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetQuery = vi.fn();

vi.stubGlobal("getQuery", mockGetQuery);
vi.mock("../../../server/utils/search");

import { searchFeedItems } from "../../../server/utils/search";
import handler from "../../../server/api/search.get";

const mockSearchFeedItems = vi.mocked(searchFeedItems);

const mockFeedItem = {
  id: 1,
  feedId: 10,
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Content about testing",
  tags: ["test"],
  publishedAt: null,
  readAt: null,
  starred: false,
  savedAt: null,
  createdAt: null,
  updatedAt: null,
  type: "article",
  source: "Test Feed",
  time: "2h",
};

const mockPage = { items: [mockFeedItem], nextOffset: null };

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetQuery.mockReturnValue({});
  });

  it("throws 401 when unauthenticated", async () => {
    mockGetQuery.mockReturnValue({ q: "test" });
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when query parameter is missing", async () => {
    mockGetQuery.mockReturnValue({});
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when query parameter is blank", async () => {
    mockGetQuery.mockReturnValue({ q: "   " });
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns the search page for an authenticated user", async () => {
    mockGetQuery.mockReturnValue({ q: "testing" });
    mockSearchFeedItems.mockResolvedValue(mockPage);
    const event = { context: { user: { id: 1 } } };

    const result = await handler(event);

    expect(result).toEqual(mockPage);
  });

  it("calls searchFeedItems with the authenticated user id, trimmed query, and default paging options", async () => {
    mockGetQuery.mockReturnValue({ q: "  hello world  " });
    mockSearchFeedItems.mockResolvedValue({ items: [], nextOffset: null });
    const event = { context: { user: { id: 42 } } };

    await handler(event);

    expect(mockSearchFeedItems).toHaveBeenCalledWith(42, "hello world", {
      limit: undefined,
      offset: undefined,
    });
  });

  it("parses limit and offset from the query string and passes them through", async () => {
    mockGetQuery.mockReturnValue({ q: "testing", limit: "20", offset: "40" });
    mockSearchFeedItems.mockResolvedValue({ items: [], nextOffset: null });
    const event = { context: { user: { id: 1 } } };

    await handler(event);

    expect(mockSearchFeedItems).toHaveBeenCalledWith(1, "testing", {
      limit: 20,
      offset: 40,
    });
  });

  it("passes undefined for non-numeric limit and offset", async () => {
    mockGetQuery.mockReturnValue({
      q: "testing",
      limit: "abc",
      offset: "40xyz",
    });
    mockSearchFeedItems.mockResolvedValue({ items: [], nextOffset: null });
    const event = { context: { user: { id: 1 } } };

    await handler(event);

    expect(mockSearchFeedItems).toHaveBeenCalledWith(1, "testing", {
      limit: undefined,
      offset: undefined,
    });
  });

  it("drops an offset too large to be a safe integer instead of passing it through", async () => {
    mockGetQuery.mockReturnValue({ q: "testing", offset: "9".repeat(20) });
    mockSearchFeedItems.mockResolvedValue({ items: [], nextOffset: null });
    const event = { context: { user: { id: 1 } } };

    await handler(event);

    expect(mockSearchFeedItems).toHaveBeenCalledWith(1, "testing", {
      limit: undefined,
      offset: undefined,
    });
  });

  it("returns nextOffset as a number when more pages exist", async () => {
    mockGetQuery.mockReturnValue({ q: "testing" });
    mockSearchFeedItems.mockResolvedValue({
      items: [mockFeedItem],
      nextOffset: 20,
    });
    const event = { context: { user: { id: 1 } } };

    const result = await handler(event);

    expect(result.nextOffset).toBe(20);
  });

  it("returns an empty page when no results are found", async () => {
    mockGetQuery.mockReturnValue({ q: "noresults" });
    mockSearchFeedItems.mockResolvedValue({ items: [], nextOffset: null });
    const event = { context: { user: { id: 1 } } };

    const result = await handler(event);

    expect(result).toEqual({ items: [], nextOffset: null });
  });
});
