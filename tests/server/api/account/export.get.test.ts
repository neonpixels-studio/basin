import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFeedsFindMany = vi.fn();
const mockFeedItemsFindMany = vi.fn();
const mockSettingsFindFirst = vi.fn();
const mockIntegrationsFindMany = vi.fn();
const mockSetHeader = vi.fn();

// db.select(...).from(...).where(...) builds the ownership subquery fed to
// inArray; it only needs to be chainable since findMany is mocked.
const mockSubquery = { from: () => ({ where: () => "owned-feed-ids" }) };

vi.stubGlobal("useDb", () => ({
  select: () => mockSubquery,
  query: {
    feeds: { findMany: mockFeedsFindMany },
    feedItems: { findMany: mockFeedItemsFindMany },
    userSettings: { findFirst: mockSettingsFindFirst },
    integrations: { findMany: mockIntegrationsFindMany },
  },
}));
vi.stubGlobal("setHeader", mockSetHeader);

import handler from "../../../../server/api/account/export.get";

const mockUser = {
  id: 1,
  providerId: "user_abc",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const mockFeed = {
  id: 10,
  url: "https://example.com/feed.xml",
  title: "Example Feed",
  description: null,
  source: "rss",
  sourceOverride: null,
  paused: false,
  lastFetched: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
};

const mockSavedItem = {
  feedId: 10,
  guid: "guid-1",
  title: "Saved Article",
  url: "https://example.com/a",
  author: null,
  imageUrl: null,
  content: null,
  tags: null,
  publishedAt: new Date("2026-02-02T00:00:00.000Z"),
  readAt: null,
  starred: true,
  savedAt: new Date("2026-03-03T00:00:00.000Z"),
  mediaUrl: null,
  mediaDuration: null,
};

function eventFor(user: unknown) {
  return { context: { user } };
}

describe("GET /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeedsFindMany.mockResolvedValue([mockFeed]);
    mockFeedItemsFindMany.mockResolvedValue([mockSavedItem]);
    mockSettingsFindFirst.mockResolvedValue(undefined);
    mockIntegrationsFindMany.mockResolvedValue([]);
  });

  it("throws 401 when unauthenticated", async () => {
    await expect(handler(eventFor(null))).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("returns the user's sources and saved items", async () => {
    const result = await handler(eventFor(mockUser));

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe("https://example.com/feed.xml");
    expect(result.savedItems).toHaveLength(1);
    expect(result.savedItems[0]).toMatchObject({
      feedUrl: "https://example.com/feed.xml",
      title: "Saved Article",
      starred: true,
    });
  });

  it("scopes the feeds query to the authenticated user", async () => {
    await handler(eventFor(mockUser));
    const whereForUserOne = mockFeedsFindMany.mock.calls[0][0].where;

    vi.clearAllMocks();
    mockFeedsFindMany.mockResolvedValue([mockFeed]);
    mockFeedItemsFindMany.mockResolvedValue([]);
    mockIntegrationsFindMany.mockResolvedValue([]);
    await handler(eventFor({ ...mockUser, id: 2 }));
    const whereForUserTwo = mockFeedsFindMany.mock.calls[0][0].where;

    // A per-user filter must be present and must change with the user id;
    // dropping `where: eq(feeds.userId, user.id)` would make these identical.
    expect(whereForUserOne).toBeDefined();
    expect(whereForUserOne).not.toEqual(whereForUserTwo);
  });

  it("returns an empty saved-items list when the user has none", async () => {
    mockFeedItemsFindMany.mockResolvedValue([]);

    const result = await handler(eventFor(mockUser));

    expect(result.savedItems).toEqual([]);
  });

  it("requests integrations without token columns", async () => {
    await handler(eventFor(mockUser));

    expect(mockIntegrationsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: {
          accessToken: false,
          refreshToken: false,
          tokenSecret: false,
        },
      }),
    );
  });

  it("returns null settings when the user has none", async () => {
    const result = await handler(eventFor(mockUser));
    expect(result.settings).toBeNull();
  });

  it("sets JSON content-type and attachment headers", async () => {
    await handler(eventFor(mockUser));

    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Type",
      expect.stringContaining("application/json"),
    );
    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Content-Disposition",
      expect.stringContaining("reader-data-export.json"),
    );
  });
});
