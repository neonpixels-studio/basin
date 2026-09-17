import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deriveFeedItemFields,
  type FeedItemDerivationInput,
} from "../../../server/utils/feedItemMapper";

const baseRow: FeedItemDerivationInput = {
  feedSource: "rss",
  feedTitle: "Test Feed",
  publishedAt: null,
  readAt: null,
};

describe("deriveFeedItemFields", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // "rss" and "bluesky" are deliberately non-identity mappings (rss ->
  // "article", bluesky -> "tweet") so the assertion can only pass if the
  // FEED_SOURCE_TO_ITEM_TYPE lookup actually ran — an identity mapping like
  // "podcast" -> "podcast" would pass even if the lookup were deleted.
  it("maps feedSource to the corresponding item type", () => {
    expect(deriveFeedItemFields({ ...baseRow, feedSource: "rss" }).type).toBe(
      "article",
    );
    expect(
      deriveFeedItemFields({ ...baseRow, feedSource: "bluesky" }).type,
    ).toBe("tweet");
  });

  it("falls back to the raw feedSource when no type mapping exists", () => {
    expect(
      deriveFeedItemFields({ ...baseRow, feedSource: "newsletter" }).type,
    ).toBe("newsletter");
  });

  it("uses feedTitle as source when present", () => {
    expect(deriveFeedItemFields(baseRow).source).toBe("Test Feed");
  });

  it("falls back to feedSource when feedTitle is null, empty, or whitespace", () => {
    expect(deriveFeedItemFields({ ...baseRow, feedTitle: null }).source).toBe(
      "rss",
    );
    expect(deriveFeedItemFields({ ...baseRow, feedTitle: "" }).source).toBe(
      "rss",
    );
    expect(deriveFeedItemFields({ ...baseRow, feedTitle: "   " }).source).toBe(
      "rss",
    );
  });

  it("formats publishedAt into the short relative time token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));

    expect(
      deriveFeedItemFields({
        ...baseRow,
        publishedAt: new Date("2026-01-01T10:00:00Z"),
      }).time,
    ).toBe("2h");
  });

  it("returns an empty time string when publishedAt is null", () => {
    expect(deriveFeedItemFields(baseRow).time).toBe("");
  });

  // Regression: #247. Both search.ts's mapSearchRow and feedItems.ts's mapRow
  // derive `unread` through this function now, so they can't drift apart the
  // way they did before this refactor.
  it("derives unread=true from a null readAt", () => {
    expect(deriveFeedItemFields({ ...baseRow, readAt: null }).unread).toBe(
      true,
    );
  });

  it("derives unread=false from a non-null readAt", () => {
    expect(
      deriveFeedItemFields({
        ...baseRow,
        readAt: new Date("2026-01-01T00:00:00Z"),
      }).unread,
    ).toBe(false);
  });
});

// Type-level note on the compile-time guarantee this refactor actually gives:
// mapSearchRow (search.ts) and mapRow (feedItems.ts) both declare an explicit
// return type (SearchResult / FeedItemResult) and spread
// deriveFeedItemFields()'s result into it. TypeScript's excess-property check
// does not apply to spread properties, so adding a field to
// FeedItemDerivedFields alone is NOT by itself a compile error at either call
// site — it silently flows through unused. What IS a hard compile error: a
// field declared on SearchResult or FeedItemResult that deriveFeedItemFields
// doesn't produce (a missing-property error on the object literal), which is
// the direction #247 actually broke in (a field existed on one result type's
// hand-rolled mapper but not the other's). Keep this comment in sync with
// server/utils/feedItemMapper.ts if that guarantee's shape changes.
