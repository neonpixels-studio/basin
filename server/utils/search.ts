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
// splitting on them would glue those into the unmatchable "scifi").
const TSQUERY_TERM_SEPARATOR = /[^\p{L}\p{N}]+/gu;

// A prefix term below this length turns every keystroke into a broad GIN
// index scan (e.g. "z:*" matches every lexeme starting with "z"); below the
// floor we just skip the term rather than sending the DB a wildcard scan
// only the first keystroke would trigger.
const MIN_PREFIX_TERM_LENGTH = 2;

// Bounds on how large a tsquery we build, so a very long or many-word input
// can't produce an unbounded number of ANDed terms or a single oversized
// lexeme — either of which risks tsquery's own size limits and unnecessary
// planning cost for a search box that only shows SEARCH_RESULT_LIMIT results.
const MAX_SEARCH_TERMS = 10;
const MAX_TERM_LENGTH = 64;

/**
 * Builds a `to_tsquery`-compatible prefix expression from free-text input,
 * e.g. "cool podcas" -> "cool:* & podcas:*". Each term gets a `:*` prefix
 * marker so a partial word — as typed incrementally into the Cmd-K palette —
 * matches any word it's a prefix of, and terms are ANDed together to keep the
 * "match every term" behavior `plainto_tsquery` had.
 * Returns an empty string when the input has no searchable characters.
 */
export function buildPrefixTsQuery(query: string): string {
  return query
    .split(TSQUERY_TERM_SEPARATOR)
    .filter((term) => term.length >= MIN_PREFIX_TERM_LENGTH)
    .slice(0, MAX_SEARCH_TERMS)
    .map((term) => `${term.slice(0, MAX_TERM_LENGTH)}:*`)
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
  }));
}
