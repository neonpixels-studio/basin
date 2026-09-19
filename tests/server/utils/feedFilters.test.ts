import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  ALL_FILTER,
  SAVED_FILTER,
  STARRED_FILTER,
  VALID_FEED_FILTERS,
  feedSourcesForItemType,
  feedSourcesForFilter,
  savedStarredFilterCondition,
} from "../../../server/utils/feedFilters";

const dialect = new PgDialect();

describe("VALID_FEED_FILTERS", () => {
  it("accepts the non-source views", () => {
    expect(VALID_FEED_FILTERS.has(ALL_FILTER)).toBe(true);
    expect(VALID_FEED_FILTERS.has(SAVED_FILTER)).toBe(true);
    expect(VALID_FEED_FILTERS.has(STARRED_FILTER)).toBe(true);
  });

  it("accepts each item type produced by a known source", () => {
    expect(VALID_FEED_FILTERS.has("article")).toBe(true);
    expect(VALID_FEED_FILTERS.has("tweet")).toBe(true);
  });

  it("rejects unknown filter ids", () => {
    expect(VALID_FEED_FILTERS.has("bogus")).toBe(false);
  });
});

describe("feedSourcesForItemType", () => {
  it("maps an item type back to every source that yields it", () => {
    // "tweet" is produced by both the "tweet" and "bluesky" sources.
    expect(feedSourcesForItemType("tweet").sort()).toEqual([
      "bluesky",
      "tweet",
    ]);
  });

  it("returns an empty list for an unknown type", () => {
    expect(feedSourcesForItemType("nope")).toEqual([]);
  });
});

describe("feedSourcesForFilter", () => {
  it("returns null for the non-source views", () => {
    expect(feedSourcesForFilter(undefined)).toBeNull();
    expect(feedSourcesForFilter(ALL_FILTER)).toBeNull();
    expect(feedSourcesForFilter(SAVED_FILTER)).toBeNull();
    expect(feedSourcesForFilter(STARRED_FILTER)).toBeNull();
  });

  it("returns the backing sources for a type filter", () => {
    expect(feedSourcesForFilter("article")).toEqual(["rss"]);
  });
});

describe("savedStarredFilterCondition", () => {
  it("narrows to items with a savedAt for the saved filter", () => {
    const condition = savedStarredFilterCondition(SAVED_FILTER);
    expect(condition).toBeDefined();
    expect(dialect.sqlToQuery(condition!).sql).toContain(
      '"saved_at" is not null',
    );
  });

  it("narrows to starred items for the starred filter", () => {
    const condition = savedStarredFilterCondition(STARRED_FILTER);
    expect(condition).toBeDefined();
    const { sql, params } = dialect.sqlToQuery(condition!);
    expect(sql).toContain('"starred" =');
    expect(params).toContain(true);
  });

  it("returns undefined for the all and type filters", () => {
    expect(savedStarredFilterCondition(ALL_FILTER)).toBeUndefined();
    expect(savedStarredFilterCondition("article")).toBeUndefined();
    expect(savedStarredFilterCondition(undefined)).toBeUndefined();
  });
});
