import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockSelectWhere = vi.fn();

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
  update: mockUpdate,
}));

import { markAllItemsRead } from "../../../server/utils/markAllRead";

// Render the drizzle SQL condition passed to a mocked .where() into real SQL so
// assertions pin the operator (is null / is not null / in), not just the column
// name — an isNull→isNotNull swap must fail the test.
const dialect = new PgDialect();

function renderUpdateWhere(): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockUpdateWhere.mock.calls[0][0]);
}

function renderSelectWhere(): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockSelectWhere.mock.calls[0][0]);
}

describe("markAllItemsRead", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelectWhere.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues a single update over the resolved feed ids", async () => {
    await markAllItemsRead(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const { sql, params } = renderUpdateWhere();
    expect(sql).toContain('"feed_id" in');
    expect(params).toContain(1);
    expect(params).toContain(2);
  });

  it("sets readAt to now, marking items read", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-02T03:04:05.000Z");
    vi.setSystemTime(now);

    await markAllItemsRead(1);

    expect(mockSet).toHaveBeenCalledWith({ readAt: now });
  });

  it("only touches unread items (read_at IS NULL), never already-read ones", async () => {
    await markAllItemsRead(1);
    // Fails if isNull(readAt) is swapped for isNotNull (would read "is not null").
    expect(renderUpdateWhere().sql).toContain('"read_at" is null');
  });

  it("scopes the feed lookup to the user", async () => {
    await markAllItemsRead(7);
    const { sql, params } = renderSelectWhere();
    expect(sql).toContain('"user_id"');
    expect(params).toContain(7);
  });

  it("scopes to the filter's feed sources for a type filter", async () => {
    await markAllItemsRead(1, { filter: "article" });
    const { sql, params } = renderSelectWhere();
    expect(sql).toContain('"source" in');
    // "article" items come from "rss" feeds (FEED_SOURCE_TO_ITEM_TYPE).
    expect(params).toContain("rss");
  });

  it("maps the tweet filter to both tweet and bluesky sources", async () => {
    await markAllItemsRead(1, { filter: "tweet" });
    const { params } = renderSelectWhere();
    expect(params).toContain("tweet");
    expect(params).toContain("bluesky");
  });

  it("narrows to saved items (saved_at IS NOT NULL) for the saved filter", async () => {
    await markAllItemsRead(1, { filter: "saved" });

    // "saved" is not a source, so the feed lookup stays unscoped by source...
    expect(renderSelectWhere().sql).not.toContain('"source"');
    // ...but the item update is narrowed to saved rows. Fails if isNotNull is
    // swapped for isNull.
    expect(renderUpdateWhere().sql).toContain('"saved_at" is not null');
  });

  it("does not restrict sources for the all filter", async () => {
    await markAllItemsRead(1, { filter: "all" });
    expect(renderSelectWhere().sql).not.toContain('"source"');
  });

  it("skips the update entirely when the user owns no matching feeds", async () => {
    mockSelectWhere.mockResolvedValue([]);

    await markAllItemsRead(1);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
