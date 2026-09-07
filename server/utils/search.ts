import { sql, eq } from "drizzle-orm";
import { feedItems, feeds } from "../db/schema";
import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";
import { formatRelativeTime } from "../../app/utils/feedTime";

export const SEARCH_RESULT_LIMIT = 20;

// Anything that isn't a Unicode letter or digit is stripped from each term.
// This isn't a SQL-injection guard (the sanitized string is still passed as a
// bound parameter below, never spliced into the SQL text) — it's what stops
// tsquery operator characters (& | ! ( ) :) in user input from being
// interpreted as tsquery syntax, which would otherwise let a search term
// change the query's logic or throw a syntax error.
const TSQUERY_UNSAFE_CHARS = /[^\p{L}\p{N}]+/gu;

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
    .split(/\s+/)
    .map((term) => term.replace(TSQUERY_UNSAFE_CHARS, ""))
    .filter((term) => term.length > 0)
    .map((term) => `${term}:*`)
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
      sql`${feeds.userId} = ${userId} AND ${feedItems.searchVector} @@ to_tsquery('english', ${tsQuery})`,
    )
    .orderBy(
      sql`ts_rank(${feedItems.searchVector}, to_tsquery('english', ${tsQuery})) DESC`,
    )
    .limit(SEARCH_RESULT_LIMIT);

  return rows.map(({ feedSource, feedTitle, ...item }) => ({
    ...item,
    type: FEED_SOURCE_TO_ITEM_TYPE[feedSource] ?? feedSource,
    source: feedTitle?.trim() || feedSource,
    time: formatRelativeTime(item.publishedAt),
  }));
}
