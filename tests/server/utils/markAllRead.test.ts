import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockSelectWhere = vi.fn();

const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockReturning = vi.fn();

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
  update: mockUpdate,
}));

import { markAllItemsRead } from "../../../server/utils/markAllRead";

// Drizzle SQL objects hold circular references, so collect primitive leaves by
// walking queryChunks recursively (mirrors tests/server/api/sync.post.test.ts).
function collectLeaves(node: unknown, seen = new Set<unknown>()): unknown[] {
  if (node === null || node === undefined) {
    return [];
  }
  if (typeof node !== "object") {
    return [node];
  }
  if (seen.has(node)) {
    return [];
  }
  seen.add(node);
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectLeaves(item, seen));
  }
  const obj = node as Record<string, unknown>;
  if (obj.queryChunks !== undefined) {
    return collectLeaves(obj.queryChunks, seen);
  }
  if (obj.value !== undefined) {
    return collectLeaves(obj.value, seen);
  }
  if (obj.name !== undefined) {
    return [obj.name];
  }
  return [];
}

function updateWhereLeaves(): unknown[] {
  return collectLeaves(mockUpdateWhere.mock.calls[0][0]);
}

function selectWhereLeaves(): unknown[] {
  return collectLeaves(mockSelectWhere.mock.calls[0][0]);
}

describe("markAllItemsRead", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockSelectWhere });
    mockSelectWhere.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the number of items actually flipped to read", async () => {
    const marked = await markAllItemsRead(1);
    expect(marked).toBe(3);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("sets readAt to now, marking items read", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-02T03:04:05.000Z");
    vi.setSystemTime(now);

    await markAllItemsRead(1);

    expect(mockSet).toHaveBeenCalledWith({ readAt: now });
  });

  it("only touches unread items (read_at IS NULL) owned by the user", async () => {
    await markAllItemsRead(7);

    // Ownership scoping: the feed lookup filters on user_id.
    expect(selectWhereLeaves()).toContain("user_id");
    expect(selectWhereLeaves()).toContain(7);

    // The update is bounded to the resolved feed ids and unread rows only.
    const leaves = updateWhereLeaves();
    expect(leaves).toContain("feed_id");
    expect(leaves).toContain("read_at");
    expect(leaves).toContain(1);
    expect(leaves).toContain(2);
  });

  it("scopes to the filter's feed sources for a type filter", async () => {
    await markAllItemsRead(1, { filter: "article" });

    const leaves = selectWhereLeaves();
    expect(leaves).toContain("source");
    // "article" items come from "rss" feeds (FEED_SOURCE_TO_ITEM_TYPE).
    expect(leaves).toContain("rss");
  });

  it("maps the tweet filter to both tweet and bluesky sources", async () => {
    await markAllItemsRead(1, { filter: "tweet" });

    const leaves = selectWhereLeaves();
    expect(leaves).toContain("tweet");
    expect(leaves).toContain("bluesky");
  });

  it("narrows to saved items (saved_at IS NOT NULL) for the saved filter", async () => {
    await markAllItemsRead(1, { filter: "saved" });

    // "saved" is not a source, so the feed lookup stays unscoped by source...
    expect(selectWhereLeaves()).not.toContain("source");
    // ...but the item update is narrowed to saved rows.
    expect(updateWhereLeaves()).toContain("saved_at");
  });

  it("does not restrict sources for the all filter", async () => {
    await markAllItemsRead(1, { filter: "all" });
    expect(selectWhereLeaves()).not.toContain("source");
  });

  it("skips the update and returns 0 when the user owns no matching feeds", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const marked = await markAllItemsRead(1);

    expect(marked).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
