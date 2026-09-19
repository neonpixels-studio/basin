import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { feedItems } from "../../../server/db/schema";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
}));

import {
  fetchFeedItems,
  fetchFeedItemCounts,
  FEED_ITEMS_DEFAULT_LIMIT,
  FEED_ITEMS_MAX_LIMIT,
  type FeedItemRow,
  type FeedItemResult,
} from "../../../server/utils/feedItems";

// Render the drizzle SQL passed to a mocked .where() into real SQL so filter
// assertions pin the operator (in / is not null / = true), not just a column
// name — a saved→starred swap must fail the test.
const dialect = new PgDialect();

function renderWhere(): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockWhere.mock.calls[0][0]);
}

// Typed against FeedItemRow (exported by feedItems.ts) so a misspelled key
// here fails to compile instead of silently being accepted.
// Date/media columns get distinct non-null values (rather than all sharing
// `null`) so a mapRow field swap — e.g. createdAt/updatedAt transposed —
// fails the full-shape assertion below instead of passing unnoticed.
const mockRow: FeedItemRow = {
  id: 1,
  feedId: 10,
  feedSource: "rss",
  feedTitle: "Test Feed",
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Article content",
  tags: ["test"],
  publishedAt: new Date("2026-01-01T10:00:00Z"),
  readAt: null,
  starred: false,
  savedAt: null,
  mediaUrl: "https://example.com/audio.mp3",
  mediaDuration: 1234,
  createdAt: new Date("2026-01-01T08:00:00Z"),
  updatedAt: new Date("2026-01-01T09:00:00Z"),
};

// Expected result after the mapping step derives type/source/handle/time/
// unread/saved and passes the rest of the columns through unchanged.
const expectedResult: FeedItemResult = {
  id: 1,
  feedId: 10,
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Article content",
  tags: ["test"],
  publishedAt: new Date("2026-01-01T10:00:00Z"),
  readAt: null,
  starred: false,
  savedAt: null,
  mediaUrl: "https://example.com/audio.mp3",
  mediaDuration: 1234,
  createdAt: new Date("2026-01-01T08:00:00Z"),
  updatedAt: new Date("2026-01-01T09:00:00Z"),
  type: "article",
  source: "Test Feed",
  handle: "Test Feed",
  time: "2h",
  unread: true,
  saved: false,
};

describe("fetchFeedItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ offset: mockOffset });
    mockOffset.mockResolvedValue([]);
    // mockRow.publishedAt is fixed at 2026-01-01T10:00:00Z so `time` derives
    // to a stable "2h" against this frozen clock, instead of drifting as
    // real time passes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Pins the full mapRow output — including every raw passthrough column —
  // against distinct, non-null fixture values so a field transposed in
  // mapRow (e.g. createdAt/updatedAt swapped) fails this assertion instead
  // of passing unnoticed the way #276 (missing mediaUrl/mediaDuration) did.
  it("maps a row to the full FeedItemResult shape", async () => {
    mockOffset.mockResolvedValue([mockRow]);
    const result = await fetchFeedItems(1, {});
    expect(result.items).toEqual([expectedResult]);
  });

  // Regression guard mirroring search.test.ts's equivalent for #275/#276:
  // every test above feeds a hand-built row straight into the mocked
  // .offset(), so nothing else pins that the query actually selects these
  // columns — dropping readAt/savedAt from the projection would leave
  // row.readAt/savedAt undefined at runtime, deriving unread=false and
  // saved=true for every item regardless of their real state; dropping
  // mediaUrl/mediaDuration would silently break podcast/video playback from
  // the dashboard feed the way #276 broke it from search.
  it("selects readAt/savedAt and the media columns so derived fields come from real columns, not undefined", async () => {
    await fetchFeedItems(1, {});

    // Pinned to the exact column objects, not just the key names — a key
    // present but mis-wired to the wrong column (e.g. `savedAt:
    // feedItems.readAt`) would still pass an Object.keys-only check.
    const selection = mockSelect.mock.calls[0][0];
    expect(selection.readAt).toBe(feedItems.readAt);
    expect(selection.savedAt).toBe(feedItems.savedAt);
    expect(selection.mediaUrl).toBe(feedItems.mediaUrl);
    expect(selection.mediaDuration).toBe(feedItems.mediaDuration);
  });

  it("returns empty items array when no rows are found", async () => {
    const result = await fetchFeedItems(1, {});
    expect(result.items).toEqual([]);
    expect(result.nextOffset).toBeNull();
  });

  it("maps rss feedSource to article type", async () => {
    mockOffset.mockResolvedValue([mockRow]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].type).toBe("article");
  });

  it("maps podcast feedSource to podcast type", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, feedSource: "podcast" }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].type).toBe("podcast");
  });

  it("falls back to raw feedSource when no type mapping exists", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, feedSource: "newsletter" }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].type).toBe("newsletter");
  });

  it("uses feedTitle as source when present", async () => {
    mockOffset.mockResolvedValue([mockRow]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].source).toBe("Test Feed");
  });

  it("falls back to feedSource when feedTitle is null", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, feedTitle: null }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].source).toBe("rss");
  });

  it("falls back to feedSource when feedTitle is empty string", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, feedTitle: "" }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].source).toBe("rss");
  });

  it("marks item as unread when readAt is null", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, readAt: null }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].unread).toBe(true);
  });

  it("marks item as read when readAt is set", async () => {
    mockOffset.mockResolvedValue([
      { ...mockRow, readAt: new Date("2026-01-01") },
    ]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].unread).toBe(false);
  });

  it("marks item as saved when savedAt is set", async () => {
    mockOffset.mockResolvedValue([
      { ...mockRow, savedAt: new Date("2026-01-01") },
    ]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].saved).toBe(true);
  });

  it("marks item as not saved when savedAt is null", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, savedAt: null }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].saved).toBe(false);
  });

  it("sets nextOffset when there are more items than the limit", async () => {
    const rows = Array.from(
      { length: FEED_ITEMS_DEFAULT_LIMIT + 1 },
      (_, i) => ({
        ...mockRow,
        id: i + 1,
      }),
    );
    mockOffset.mockResolvedValue(rows);
    const result = await fetchFeedItems(1, {});
    expect(result.items).toHaveLength(FEED_ITEMS_DEFAULT_LIMIT);
    expect(result.nextOffset).toBe(FEED_ITEMS_DEFAULT_LIMIT);
  });

  it("sets nextOffset to null when there are no more items", async () => {
    mockOffset.mockResolvedValue([mockRow]);
    const result = await fetchFeedItems(1, {});
    expect(result.nextOffset).toBeNull();
  });

  it("applies the offset parameter to subsequent pages", async () => {
    mockOffset.mockResolvedValue([]);
    await fetchFeedItems(1, { offset: 50 });
    expect(mockOffset).toHaveBeenCalledWith(50);
  });

  it("computes nextOffset as offset + limit for non-first pages", async () => {
    const rows = Array.from(
      { length: FEED_ITEMS_DEFAULT_LIMIT + 1 },
      (_, i) => ({
        ...mockRow,
        id: i + 1,
      }),
    );
    mockOffset.mockResolvedValue(rows);
    const result = await fetchFeedItems(1, { offset: 50 });
    expect(result.nextOffset).toBe(50 + FEED_ITEMS_DEFAULT_LIMIT);
  });

  it("maps feedTitle to handle field on results", async () => {
    mockOffset.mockResolvedValue([mockRow]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].handle).toBe("Test Feed");
  });

  it("falls back to feedSource for handle when feedTitle is blank", async () => {
    mockOffset.mockResolvedValue([{ ...mockRow, feedTitle: "   " }]);
    const result = await fetchFeedItems(1, {});
    expect(result.items[0].handle).toBe("rss");
  });

  it("clamps limit to the maximum allowed value", async () => {
    mockOffset.mockResolvedValue([]);
    await fetchFeedItems(1, { limit: 9999 });
    expect(mockLimit).toHaveBeenCalledWith(FEED_ITEMS_MAX_LIMIT + 1);
  });

  it("uses the default limit when none is provided", async () => {
    mockOffset.mockResolvedValue([]);
    await fetchFeedItems(1, {});
    expect(mockLimit).toHaveBeenCalledWith(FEED_ITEMS_DEFAULT_LIMIT + 1);
  });

  it("uses the provided limit when within bounds", async () => {
    mockOffset.mockResolvedValue([]);
    await fetchFeedItems(1, { limit: 10 });
    expect(mockLimit).toHaveBeenCalledWith(11);
  });

  it("calls select, from, innerJoin, where, orderBy, limit, offset in order", async () => {
    await fetchFeedItems(1, {});
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledTimes(1);
    expect(mockOffset).toHaveBeenCalledTimes(1);

    const [selectOrder] = mockSelect.mock.invocationCallOrder;
    const [fromOrder] = mockFrom.mock.invocationCallOrder;
    const [innerJoinOrder] = mockInnerJoin.mock.invocationCallOrder;
    const [whereOrder] = mockWhere.mock.invocationCallOrder;
    const [orderByOrder] = mockOrderBy.mock.invocationCallOrder;
    const [limitOrder] = mockLimit.mock.invocationCallOrder;
    const [offsetOrder] = mockOffset.mock.invocationCallOrder;

    expect(selectOrder).toBeLessThan(fromOrder);
    expect(fromOrder).toBeLessThan(innerJoinOrder);
    expect(innerJoinOrder).toBeLessThan(whereOrder);
    expect(whereOrder).toBeLessThan(orderByOrder);
    expect(orderByOrder).toBeLessThan(limitOrder);
    expect(limitOrder).toBeLessThan(offsetOrder);
  });

  describe("filter scoping", () => {
    it("scopes to the user with no filter restriction by default", async () => {
      await fetchFeedItems(42, {});
      const { sql, params } = renderWhere();
      expect(sql).toContain('"user_id" =');
      expect(params).toContain(42);
      expect(sql).not.toContain("saved_at");
      expect(sql).not.toContain("starred");
    });

    it("restricts by feed source for a type filter", async () => {
      await fetchFeedItems(1, { filter: "tweet" });
      const { sql, params } = renderWhere();
      // "tweet" is produced by both the "tweet" and "bluesky" sources.
      expect(sql).toContain('"source" in');
      expect(params).toContain("tweet");
      expect(params).toContain("bluesky");
    });

    it("restricts to saved items for the saved filter", async () => {
      await fetchFeedItems(1, { filter: "saved" });
      const { sql } = renderWhere();
      expect(sql).toContain('"saved_at" is not null');
      expect(sql).not.toContain('"source" in');
    });

    it("restricts to starred items for the starred filter", async () => {
      await fetchFeedItems(1, { filter: "starred" });
      const { sql, params } = renderWhere();
      expect(sql).toContain('"starred" =');
      expect(params).toContain(true);
      expect(sql).not.toContain('"source" in');
    });

    it("applies no saved/starred/source restriction for the all filter", async () => {
      await fetchFeedItems(1, { filter: "all" });
      const { sql } = renderWhere();
      expect(sql).not.toContain("saved_at");
      expect(sql).not.toContain('"source" in');
    });
  });

  it("orders by publishedAt desc nulls last then id desc for deterministic pagination", async () => {
    await fetchFeedItems(1, {});
    // orderBy must receive two arguments: publishedAt DESC NULLS LAST (so items
    // without a date sort to the bottom) and id DESC as a deterministic tiebreaker
    // when multiple items share the same timestamp.
    expect(mockOrderBy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("fetchFeedItemCounts", () => {
  const countsRow = {
    all: 10,
    saved: 3,
    starred: 2,
    article: 5,
    podcast: 1,
    video: 2,
    tweet: 2,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([countsRow]);
  });

  it("returns whole-account totals per filter id", async () => {
    const counts = await fetchFeedItemCounts(1);
    expect(counts).toMatchObject({
      all: 10,
      saved: 3,
      starred: 2,
      article: 5,
      podcast: 1,
      video: 2,
      tweet: 2,
    });
  });

  it("scopes the aggregate to the authenticated user", async () => {
    await fetchFeedItemCounts(7);
    const { sql, params } = renderWhere();
    expect(sql).toContain('"user_id" =');
    expect(params).toContain(7);
  });

  it("coerces bigint-string counts to numbers", async () => {
    mockWhere.mockResolvedValue([
      {
        all: "10",
        saved: "3",
        starred: "0",
        article: "10",
        podcast: "0",
        video: "0",
        tweet: "0",
      },
    ]);
    const counts = await fetchFeedItemCounts(1);
    expect(counts.all).toBe(10);
    expect(counts.saved).toBe(3);
  });

  it("defaults every count to zero when no aggregate row is returned", async () => {
    mockWhere.mockResolvedValue([]);
    const counts = await fetchFeedItemCounts(1);
    expect(counts.all).toBe(0);
    expect(counts.saved).toBe(0);
    expect(counts.tweet).toBe(0);
  });
});
