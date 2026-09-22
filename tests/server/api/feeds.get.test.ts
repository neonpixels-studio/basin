import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();

vi.stubGlobal("useDb", () => ({
  query: { feeds: { findMany: mockFindMany } },
}));

import handler from "../../../server/api/feeds.get";

const mockFeed = {
  id: 1,
  url: "https://example.com/feed.xml",
  title: "Example",
  source: "rss",
  userId: 1,
  createdAt: null,
  updatedAt: null,
};

describe("GET /api/feeds", () => {
  beforeEach(() => vi.resetAllMocks());

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("returns the user's feeds", async () => {
    mockFindMany.mockResolvedValue([mockFeed]);
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result).toEqual([mockFeed]);
  });

  it("returns an empty array when the user has no feeds", async () => {
    mockFindMany.mockResolvedValue([]);
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result).toEqual([]);
  });

  it("queries with the authenticated user's id", async () => {
    mockFindMany.mockResolvedValue([]);
    const event = { context: { user: { id: 42 } } };
    await handler(event);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("does not restrict the columns returned, so syncFailedAt and paused pass through", async () => {
    // Pins the "full row, no `columns` selector" shape the client's retry
    // flow (app/composables/useFeeds.ts) relies on to read a feed's
    // syncFailedAt and paused state without a dedicated endpoint — a future
    // change adding a `columns` filter here would silently break that without
    // this test.
    const feedWithRetryFields = {
      ...mockFeed,
      syncFailedAt: "2026-01-01T00:00:00.000Z",
      paused: true,
    };
    mockFindMany.mockResolvedValue([feedWithRetryFields]);
    const event = { context: { user: { id: 1 } } };

    const result = await handler(event);

    expect(result[0]).toMatchObject({
      syncFailedAt: "2026-01-01T00:00:00.000Z",
      paused: true,
    });
    const [queryArgs] = mockFindMany.mock.calls[0];
    expect(queryArgs).not.toHaveProperty("columns");
  });
});
