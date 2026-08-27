import { sql, eq } from "drizzle-orm";
import { feedItems, feeds } from "../db/schema";
import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";

export const SEARCH_RESULT_LIMIT = 20;

// Formats a Date into a short relative time string (e.g. "2h", "3d", "Jan 5")
// to match the `time` field shape used by mock feed items in the UI.
export function formatRelativeTime(date: Date | null): string {
  if (!date) return "";

  const now = Date.now();
  // Clamp to 0 so a future-dated item (timezone-skewed RSS pubDates,
  // publish-ahead scheduling) floors at "0m" instead of a negative token
  // like "-125m", which the relative-time pattern would misread as an
  // absolute date.
  const diffMs = Math.max(0, now - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
      sql`${feeds.userId} = ${userId} AND ${feedItems.searchVector} @@ plainto_tsquery('english', ${query})`,
    )
    .orderBy(
      sql`ts_rank(${feedItems.searchVector}, plainto_tsquery('english', ${query})) DESC`,
    )
    .limit(SEARCH_RESULT_LIMIT);

  return rows.map(({ feedSource, feedTitle, ...item }) => ({
    ...item,
    type: FEED_SOURCE_TO_ITEM_TYPE[feedSource] ?? feedSource,
    source: feedTitle?.trim() || feedSource,
    time: formatRelativeTime(item.publishedAt),
  }));
}
