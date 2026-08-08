import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// select().from().where().orderBy() resolves to the user's feed rows.
const mockOrderBy = vi.fn();
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

// Both the pause and reactivate paths call update().set().where().returning();
// returning() yields the rows actually changed, which each function counts.
const mockUpdateReturning = vi.fn();
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
  update: mockUpdate,
}));

import {
  pauseFeedsOverFreeLimit,
  reactivateAllFeeds,
} from "../../../server/utils/feedPause";
import { FREE_PLAN_FEED_LIMIT } from "../../../server/utils/planLimits";

const dialect = new PgDialect();

// Simulates the DB returning feeds already ordered oldest-first (created_at
// asc, id asc), so ids double as position markers: id N is the Nth-oldest feed.
function feedsInDb(count: number, pausedIds: number[] = []) {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return { id, paused: pausedIds.includes(id) };
  });
  mockOrderBy.mockResolvedValue(rows);
}

const USER_ID = 42;

describe("pauseFeedsOverFreeLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feedsInDb(0);
    // Default: the update reports no rows changed; tests that expect a write
    // override this to reflect the rows returning() would yield.
    mockUpdateReturning.mockResolvedValue([]);
  });

  it("scopes the candidate query to the user", async () => {
    feedsInDb(FREE_PLAN_FEED_LIMIT + 1);
    mockUpdateReturning.mockResolvedValue([{ id: FREE_PLAN_FEED_LIMIT + 1 }]);
    await pauseFeedsOverFreeLimit(USER_ID);

    const { sql, params } = dialect.sqlToQuery(
      mockSelectWhere.mock.calls[0][0],
    );
    expect(sql).toContain('"feeds"."user_id" =');
    expect(params).toContain(USER_ID);
  });

  it("orders candidates oldest-first by created_at then id", async () => {
    feedsInDb(FREE_PLAN_FEED_LIMIT + 1);
    mockUpdateReturning.mockResolvedValue([{ id: FREE_PLAN_FEED_LIMIT + 1 }]);
    await pauseFeedsOverFreeLimit(USER_ID);

    const orderByArgs = mockOrderBy.mock.calls[0];
    // NULLS FIRST keeps anomalous null-created_at rows oldest (active), not paused.
    expect(dialect.sqlToQuery(orderByArgs[0]).sql).toContain(
      '"feeds"."created_at" asc nulls first',
    );
    expect(dialect.sqlToQuery(orderByArgs[1]).sql).toContain(
      '"feeds"."id" asc',
    );
  });

  it("leaves an account within the cap untouched", async () => {
    feedsInDb(FREE_PLAN_FEED_LIMIT);
    const result = await pauseFeedsOverFreeLimit(USER_ID);

    expect(result).toEqual({ pausedCount: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("pauses only the sources beyond the cap, keeping the oldest N active", async () => {
    feedsInDb(FREE_PLAN_FEED_LIMIT + 2);
    mockUpdateReturning.mockResolvedValue([
      { id: FREE_PLAN_FEED_LIMIT + 1 },
      { id: FREE_PLAN_FEED_LIMIT + 2 },
    ]);
    const result = await pauseFeedsOverFreeLimit(USER_ID);

    expect(result).toEqual({ pausedCount: 2 });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ paused: true }),
    );

    // The two newest feeds (ids 11 and 12) are paused; the oldest ten survive,
    // and the write is scoped to this user. Assert the full bound-param set
    // (user_id, the paused=false guard, then exactly the two over-cap ids) so
    // the test pins the precise pause selection rather than passing on any
    // param list that merely happens to contain those ids.
    const { sql, params } = dialect.sqlToQuery(
      mockUpdateWhere.mock.calls[0][0],
    );
    expect(sql).toContain('"feeds"."user_id" =');
    expect(params).toEqual([
      USER_ID,
      false,
      FREE_PLAN_FEED_LIMIT + 1,
      FREE_PLAN_FEED_LIMIT + 2,
    ]);
  });

  it("is idempotent: over-cap sources already paused are not rewritten", async () => {
    const overCapIds = [FREE_PLAN_FEED_LIMIT + 1, FREE_PLAN_FEED_LIMIT + 2];
    feedsInDb(FREE_PLAN_FEED_LIMIT + 2, overCapIds);
    const result = await pauseFeedsOverFreeLimit(USER_ID);

    expect(result).toEqual({ pausedCount: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("pauses only the still-active over-cap sources on a partial re-run", async () => {
    // Feed 11 was paused by a prior run; feed 12 was added since and is active.
    feedsInDb(FREE_PLAN_FEED_LIMIT + 2, [FREE_PLAN_FEED_LIMIT + 1]);
    mockUpdateReturning.mockResolvedValue([{ id: FREE_PLAN_FEED_LIMIT + 2 }]);
    const result = await pauseFeedsOverFreeLimit(USER_ID);

    expect(result).toEqual({ pausedCount: 1 });
    const { params } = dialect.sqlToQuery(mockUpdateWhere.mock.calls[0][0]);
    expect(params).toContain(FREE_PLAN_FEED_LIMIT + 2);
    expect(params).not.toContain(FREE_PLAN_FEED_LIMIT + 1);
  });
});

describe("reactivateAllFeeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateReturning.mockResolvedValue([]);
  });

  it("clears the paused flag on every paused source and counts them", async () => {
    mockUpdateReturning.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    const result = await reactivateAllFeeds(USER_ID);

    expect(result).toEqual({ reactivatedCount: 2 });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ paused: false }),
    );

    // Scoped to this user and to already-paused rows, so it can never clear
    // another tenant's feeds or thrash active ones.
    const { sql, params } = dialect.sqlToQuery(
      mockUpdateWhere.mock.calls[0][0],
    );
    expect(sql).toContain('"feeds"."user_id" =');
    expect(sql).toContain('"feeds"."paused" =');
    expect(params).toContain(USER_ID);
    expect(params).toContain(true);
  });

  it("is a no-op when nothing is paused", async () => {
    mockUpdateReturning.mockResolvedValue([]);
    const result = await reactivateAllFeeds(USER_ID);

    expect(result).toEqual({ reactivatedCount: 0 });
  });
});
