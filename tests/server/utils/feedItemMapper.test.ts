import { describe, it, expect } from "vitest";
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
  it("maps feedSource to the corresponding item type", () => {
    expect(
      deriveFeedItemFields({ ...baseRow, feedSource: "podcast" }).type,
    ).toBe("podcast");
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

// Type-level guard for the issue's "a future field addition is a compile
// error" requirement: deriveFeedItemFields has an explicit
// FeedItemDerivedFields return type, so search.ts's mapSearchRow and
// feedItems.ts's mapRow — both of which spread its result into an explicitly
// typed SearchResult/FeedItemResult — fail to compile the moment a new
// derived field is added here without also being added to both result
// interfaces (or vice versa). This isn't exercised at runtime; it documents
// the guarantee for anyone reading the test file. See tsconfig.json (strict)
// and the two call sites in server/utils/search.ts and
// server/utils/feedItems.ts.
