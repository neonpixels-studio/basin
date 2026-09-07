import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
}));

import {
  searchFeedItems,
  buildPrefixTsQuery,
  SEARCH_RESULT_LIMIT,
} from "../../../server/utils/search";

// search.ts composes one sql`` fragment inside another (the shared
// to_tsquery(...) expression is nested into both the where and orderBy
// clauses), so a bound parameter can be one level deeper than the outer
// fragment's own queryChunks. This walks into any nested fragment (identified
// by having its own queryChunks array) so tests can inspect the fully
// flattened chunk list regardless of nesting depth.
function flattenSqlChunks(sqlFragment: { queryChunks: unknown[] }): unknown[] {
  return sqlFragment.queryChunks.flatMap((chunk) => {
    const nested = chunk as { queryChunks?: unknown[] };
    if (nested && Array.isArray(nested.queryChunks)) {
      return flattenSqlChunks(nested as { queryChunks: unknown[] });
    }
    return [chunk];
  });
}

const mockRow = {
  id: 1,
  feedId: 10,
  feedSource: "rss",
  feedTitle: "Test Feed",
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Article content about testing",
  tags: ["test"],
  publishedAt: null,
  readAt: null,
  starred: false,
  savedAt: null,
  createdAt: null,
  updatedAt: null,
};

// Expected result after the mapping step strips feedSource/feedTitle and adds type/source/time.
const expectedResult = {
  id: 1,
  feedId: 10,
  guid: "guid-1",
  title: "Test Article",
  url: "https://example.com/article",
  author: "Jane Doe",
  imageUrl: "https://example.com/image.jpg",
  content: "Article content about testing",
  tags: ["test"],
  publishedAt: null,
  readAt: null,
  starred: false,
  savedAt: null,
  createdAt: null,
  updatedAt: null,
  type: "article",
  source: "Test Feed",
  time: "",
};

describe("searchFeedItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  it("returns matching feed items for a given user and query", async () => {
    mockLimit.mockResolvedValue([mockRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results).toEqual([expectedResult]);
  });

  it("includes author and imageUrl in results", async () => {
    mockLimit.mockResolvedValue([mockRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].author).toBe("Jane Doe");
    expect(results[0].imageUrl).toBe("https://example.com/image.jpg");
  });

  it("returns null author and imageUrl when not set", async () => {
    const noAuthorRow = { ...mockRow, author: null, imageUrl: null };
    mockLimit.mockResolvedValue([noAuthorRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].author).toBeNull();
    expect(results[0].imageUrl).toBeNull();
  });

  it("maps feedSource to the correct item type", async () => {
    const podcastRow = { ...mockRow, feedSource: "podcast" };
    mockLimit.mockResolvedValue([podcastRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].type).toBe("podcast");
  });

  it("falls back to feedSource when no type mapping exists", async () => {
    const unknownRow = { ...mockRow, feedSource: "newsletter" };
    mockLimit.mockResolvedValue([unknownRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].type).toBe("newsletter");
  });

  it("uses feedTitle as source when present", async () => {
    mockLimit.mockResolvedValue([mockRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("Test Feed");
  });

  it("falls back to feedSource when feedTitle is null", async () => {
    const noTitleRow = { ...mockRow, feedTitle: null };
    mockLimit.mockResolvedValue([noTitleRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("rss");
  });

  it("falls back to feedSource when feedTitle is an empty string", async () => {
    const emptyTitleRow = { ...mockRow, feedTitle: "" };
    mockLimit.mockResolvedValue([emptyTitleRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("rss");
  });

  it("falls back to feedSource when feedTitle is only whitespace", async () => {
    const whitespaceTitleRow = { ...mockRow, feedTitle: "   " };
    mockLimit.mockResolvedValue([whitespaceTitleRow]);

    const results = await searchFeedItems(1, "testing");

    expect(results[0].source).toBe("rss");
  });

  it("returns an empty array when there are no matches", async () => {
    mockLimit.mockResolvedValue([]);

    const results = await searchFeedItems(1, "nonexistent");

    expect(results).toEqual([]);
  });

  it("applies the result limit", async () => {
    mockLimit.mockResolvedValue([]);

    await searchFeedItems(1, "anything");

    expect(mockLimit).toHaveBeenCalledWith(SEARCH_RESULT_LIMIT);
  });

  it("calls select, from, innerJoin, where, orderBy, and limit in order", async () => {
    await searchFeedItems(42, "query");

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });

  it("builds a prefix tsquery bound as a parameter, not spliced into the SQL text", async () => {
    await searchFeedItems(1, "podcas");

    const whereChunks = flattenSqlChunks(mockWhere.mock.calls[0][0]);
    const orderByChunks = flattenSqlChunks(mockOrderBy.mock.calls[0][0]);

    // Static text chunks must never contain the raw search term — that
    // would mean it was string-concatenated into the SQL rather than bound
    // as a parameter. Filtering to chunks with an array `value` (rather than
    // checking every chunk) keeps this from breaking if a future drizzle
    // version changes how it represents columns or params internally.
    const isStaticTextChunk = (chunk: unknown): chunk is { value: string[] } =>
      typeof chunk === "object" &&
      chunk !== null &&
      Array.isArray((chunk as { value?: unknown }).value);

    const staticText = whereChunks
      .filter(isStaticTextChunk)
      .map((chunk) => chunk.value.join(""))
      .join("");
    expect(staticText).not.toContain("podcas");
    expect(staticText.length).toBeGreaterThan(0);

    expect(whereChunks).toContain("podcas:*");
    expect(orderByChunks).toContain("podcas:*");
  });

  it("does not query the database when the query has no searchable characters", async () => {
    const results = await searchFeedItems(1, "   !!!   ");

    expect(results).toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("still queries the database for a stop-word-only term, pinning the existing behavior", async () => {
    // "the" clears MIN_PREFIX_TERM_LENGTH and reaches the DB as "the:*", same
    // as it did under plainto_tsquery — Postgres's own dictionary reduces it
    // to an empty tsquery and the query returns no rows. This isn't a
    // regression, but it's worth pinning so a future change to the guard
    // (e.g. an English stop-word list) is a deliberate choice, not a surprise.
    mockLimit.mockResolvedValue([]);

    const results = await searchFeedItems(1, "the");

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(results).toEqual([]);
  });
});

describe("buildPrefixTsQuery", () => {
  it("appends a prefix marker to a single term so a partial word matches", () => {
    expect(buildPrefixTsQuery("podcas")).toBe("podcas:*");
  });

  it("ANDs multiple terms together, each with its own prefix marker", () => {
    expect(buildPrefixTsQuery("cool podcast")).toBe("cool:* & podcast:*");
  });

  it("collapses repeated whitespace between terms", () => {
    expect(buildPrefixTsQuery("cool   podcast")).toBe("cool:* & podcast:*");
  });

  it("strips tsquery operator characters so they can't be interpreted as query syntax", () => {
    expect(buildPrefixTsQuery("foo & bar:*")).toBe("foo:* & bar:*");
  });

  it("returns an empty string when there are no searchable characters", () => {
    expect(buildPrefixTsQuery("   !!!   ")).toBe("");
  });

  it("splits on hyphens so a hyphenated word still matches like Postgres's own tokenizer", () => {
    // Postgres's tokenizer lexes "sci-fi" into "sci" and "fi" separately;
    // gluing the pieces together into "scifi:*" would never match either.
    expect(buildPrefixTsQuery("sci-fi")).toBe("sci:* & fi:*");
  });

  it("drops single-character fragments left over after stripping punctuation", () => {
    // "don't" splits into "don" and "t"; "t" alone is below
    // MIN_PREFIX_TERM_LENGTH and would otherwise force a full index scan.
    expect(buildPrefixTsQuery("don't")).toBe("don:*");
  });

  it("falls back to an exact match instead of discarding the search when every term is below the prefix floor", () => {
    // A lone digit or letter (e.g. "9" in "Top 9 podcasts") is a real,
    // searchable lexeme under plainto_tsquery — dropping it entirely would
    // be a regression, so it's matched exactly rather than as a wildcard.
    expect(buildPrefixTsQuery("a")).toBe("a");
  });

  it("drops a too-short term but keeps prefix-matching the rest when at least one term clears the floor", () => {
    expect(buildPrefixTsQuery("a cool")).toBe("cool:*");
  });

  it("caps the number of ANDed terms so a very long query can't build an unbounded tsquery", () => {
    const manyWords = Array.from(
      { length: 15 },
      (_unused, index) => `term${index}`,
    );
    const tsQuery = buildPrefixTsQuery(manyWords.join(" "));

    expect(tsQuery.split(" & ")).toHaveLength(10);
    expect(tsQuery).toContain("term0:*");
    expect(tsQuery).not.toContain("term10:*");
  });

  it("truncates an individual term so a single oversized word can't build an oversized lexeme", () => {
    const longTerm = "a".repeat(100);

    expect(buildPrefixTsQuery(longTerm)).toBe(`${"a".repeat(64)}:*`);
  });

  it("truncates by whole code point so an astral-plane character isn't split into an unmatchable surrogate", () => {
    // U+20000 is outside the BMP (a UTF-16 surrogate pair, 2 code units per
    // character), so a naive UTF-16 .slice(0, MAX_TERM_LENGTH) could land
    // mid-pair. Repeating it well past MAX_TERM_LENGTH code points exercises
    // that truncation counts whole characters, not UTF-16 units.
    const astralChar = "\u{20000}";
    const longAstralTerm = astralChar.repeat(100);

    const tsQuery = buildPrefixTsQuery(longAstralTerm);

    expect(tsQuery).toBe(`${astralChar.repeat(64)}:*`);
    expect(tsQuery).not.toContain("�");
  });

  it("caps the raw input length before splitting so a huge pasted string can't balloon into a huge term array", () => {
    const hugeQuery = "z".repeat(10_000);

    const tsQuery = buildPrefixTsQuery(hugeQuery);

    // A single unbroken run of letters is one term, truncated to
    // MAX_TERM_LENGTH regardless of how long the raw input was.
    expect(tsQuery).toBe(`${"z".repeat(64)}:*`);
  });

  it("treats non-ASCII letters as valid term characters", () => {
    expect(buildPrefixTsQuery("café")).toBe("café:*");
    expect(buildPrefixTsQuery("日本語")).toBe("日本語:*");
  });
});
