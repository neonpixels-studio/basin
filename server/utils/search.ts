import { sql, eq } from "drizzle-orm";
import { feedItems, feeds } from "../db/schema";
import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";
import { formatRelativeTime } from "../../app/utils/feedTime";

export const SEARCH_RESULT_LIMIT = 20;

// Splits the query on runs of anything that isn't a Unicode letter or digit
// (whitespace, punctuation, and — importantly — tsquery operator characters
// like & | ! ( ) :). This isn't a SQL-injection guard (each resulting term is
// still passed as a bound parameter below, never spliced into the SQL text)
// — it's what stops those operator characters from being interpreted as
// tsquery syntax, while still splitting on them the way Postgres's own
// tokenizer splits "sci-fi" into "sci" and "fi" (stripping them instead of
// splitting on them would glue those into the unmatchable "scifi"). No `g`
// flag: `String.prototype.split` doesn't use (or advance) `lastIndex`.
const TSQUERY_TERM_SEPARATOR = /[^\p{L}\p{N}]+/u;

// A prefix term below this length (measured in whole code points, not UTF-16
// code units — see normalizeTerm) turns every keystroke into a broad GIN
// index scan (e.g. "z:*" matches every lexeme starting with "z"); below the
// floor we match that term exactly instead (an exact lexeme is a point
// lookup, not a wildcard scan) rather than dropping it from the query, which
// would silently stop it constraining the match entirely.
const MIN_PREFIX_TERM_LENGTH = 2;

// Bounds on how large a tsquery we build, so a very long or many-word input
// can't produce an unbounded number of ANDed terms or a single oversized
// lexeme — either of which risks tsquery's own size limits and unnecessary
// planning cost for a search box that only shows SEARCH_RESULT_LIMIT results.
export const MAX_SEARCH_TERMS = 10;
export const MAX_TERM_LENGTH = 64;
// Caps the raw input before it's split, so a huge pasted string can't
// allocate a huge intermediate array of terms only to have all but
// MAX_SEARCH_TERMS of them discarded. Sized to comfortably fit
// MAX_SEARCH_TERMS terms of MAX_TERM_LENGTH plus a single-character
// separator between each; multi-character separators (", ", " - ", etc.)
// mean the raw cap can bite slightly before the term cap does, which only
// ever shortens a prefix term — never breaks or widens a match.
const MAX_QUERY_LENGTH = MAX_SEARCH_TERMS * (MAX_TERM_LENGTH + 1);

// `.length` counts UTF-16 code units, which can both split an astral-plane
// character (e.g. rarer CJK ideographs, 2 code units) across a surrogate
// pair when truncating, and over-count it by one when checking the prefix
// floor. `Array.from` iterates by code point, so both truncation and the
// floor check land on whole characters and agree with each other.
function normalizeTerm(rawTerm: string): {
  term: string;
  isPrefixable: boolean;
} {
  const codePoints = Array.from(rawTerm).slice(0, MAX_TERM_LENGTH);
  return {
    term: codePoints.join(""),
    isPrefixable: codePoints.length >= MIN_PREFIX_TERM_LENGTH,
  };
}

/**
 * Builds a `to_tsquery`-compatible prefix expression from free-text input,
 * e.g. "cool podcas" -> "cool:* & podcas:*". Every term long enough to clear
 * MIN_PREFIX_TERM_LENGTH — including ones already fully typed, not just the
 * last, still-being-typed one — gets a `:*` prefix marker; this is a
 * deliberate simplification, so a completed word like "cat" also matches
 * "catastrophe", trading a bit of over-matching for not having to
 * special-case "which term is the one currently being typed". Terms below
 * the floor (e.g. a lone digit or letter) are still required as an exact
 * match rather than dropped, so they keep constraining the query the way
 * they did under plainto_tsquery. Terms are ANDed together to keep that
 * "match every term" behavior. Returns an empty string when the input has no
 * searchable characters.
 */
export function buildPrefixTsQuery(query: string): string {
  return query
    .slice(0, MAX_QUERY_LENGTH)
    .split(TSQUERY_TERM_SEPARATOR)
    .filter((term) => term.length > 0)
    .slice(0, MAX_SEARCH_TERMS)
    .map(normalizeTerm)
    .map(({ term, isPrefixable }) => (isPrefixable ? `${term}:*` : term))
    .join(" & ");
}

export interface SearchResult {
  id: number;
  feedId: number;
  guid: string;
  // Derived from the parent feed's source column — matches SOURCES keys in icons.js
  type: string;
  // Human-readable feed title for display in the search results
  source: string;
  // Short relative time string (e.g. "2h", "3d") matching the mock item `time` field
  time: string;
  title: string;
  url: string | null;
  author: string | null;
  imageUrl: string | null;
  content: string | null;
  tags: string[] | null;
  publishedAt: Date | null;
  readAt: Date | null;
  starred: boolean | null;
  savedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  // Derived the same way as FeedItemResult.unread (feedItems.ts) so any
  // consumer that keys off `unread` — e.g. the feed store's openItem — behaves
  // identically whether the item came from the dashboard feed or search.
  unread: boolean;
}

export async function searchFeedItems(
  userId: number,
  query: string,
): Promise<SearchResult[]> {
  const db = useDb();

  const tsQuery = buildPrefixTsQuery(query);
  if (!tsQuery) {
    return [];
  }

  // Built once so the text-search config ('english') only appears in one
  // place and can't drift out of sync between the match and rank clauses.
  const tsQueryExpression = sql`to_tsquery('english', ${tsQuery})`;

  const rows = await db
    .select({
      id: feedItems.id,
      feedId: feedItems.feedId,
      feedSource: feeds.source,
      feedTitle: feeds.title,
      guid: feedItems.guid,
      title: feedItems.title,
      url: feedItems.url,
      author: feedItems.author,
      imageUrl: feedItems.imageUrl,
      content: feedItems.content,
      tags: feedItems.tags,
      publishedAt: feedItems.publishedAt,
      readAt: feedItems.readAt,
      starred: feedItems.starred,
      savedAt: feedItems.savedAt,
      createdAt: feedItems.createdAt,
      updatedAt: feedItems.updatedAt,
    })
    .from(feedItems)
    .innerJoin(feeds, eq(feedItems.feedId, feeds.id))
    .where(
      sql`${feeds.userId} = ${userId} AND ${feedItems.searchVector} @@ ${tsQueryExpression}`,
    )
    .orderBy(sql`ts_rank(${feedItems.searchVector}, ${tsQueryExpression}) DESC`)
    .limit(SEARCH_RESULT_LIMIT);

  return rows.map(({ feedSource, feedTitle, ...item }) => ({
    ...item,
    type: FEED_SOURCE_TO_ITEM_TYPE[feedSource] ?? feedSource,
    source: feedTitle?.trim() || feedSource,
    time: formatRelativeTime(item.publishedAt),
    unread: item.readAt === null,
  }));
}
