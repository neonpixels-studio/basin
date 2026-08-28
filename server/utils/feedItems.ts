import { desc, eq, and, sql, inArray, type SQL } from "drizzle-orm";
import { feedItems, feeds } from "../db/schema";
import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";
import { formatRelativeTime } from "../../app/utils/feedTime";
import {
  SAVED_FILTER,
  STARRED_FILTER,
  feedSourcesForFilter,
  feedSourcesForItemType,
  savedStarredFilterCondition,
} from "./feedFilters";

export const FEED_ITEMS_DEFAULT_LIMIT = 50;
export const FEED_ITEMS_MAX_LIMIT = 200;

export interface FeedItemResult {
  id: number;
  feedId: number;
  guid: string;
  type: string;
  source: string;
  handle: string;
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
  mediaUrl: string | null;
  mediaDuration: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  unread: boolean;
  saved: boolean;
}

export interface FeedItemsPage {
  items: FeedItemResult[];
  total: number;
  nextOffset: number | null;
}

export interface FeedItemsQuery {
  limit?: number;
  offset?: number;
  // A dashboard filter id (feed.ts filterDefs). When omitted or "all", every
  // owned item is returned; otherwise the query is narrowed server-side so
  // Saved/Starred/type views span the whole result set, not just a loaded page.
  filter?: string;
}

function clampLimit(raw: number | undefined): number {
  const resolved = raw ?? FEED_ITEMS_DEFAULT_LIMIT;
  return Math.min(Math.max(1, resolved), FEED_ITEMS_MAX_LIMIT);
}

function resolveOffset(raw: number | undefined): number {
  return Math.max(0, raw ?? 0);
}

// Every condition that scopes the listing to one user and (optionally) one
// dashboard filter. A type filter narrows on feed source; "saved"/"starred"
// narrow on their own column. "all"/undefined add neither, so the user sees
// their whole feed. drizzle's `and()` drops the undefined entries.
function feedItemsConditions(
  userId: number,
  filter: string | undefined,
): SQL[] {
  const conditions: SQL[] = [eq(feeds.userId, userId)];
  const sources = feedSourcesForFilter(filter);
  if (sources) {
    conditions.push(inArray(feeds.source, sources));
  }
  const savedStarred = savedStarredFilterCondition(filter);
  if (savedStarred) {
    conditions.push(savedStarred);
  }
  return conditions;
}

function mapRow(row: {
  id: number;
  feedId: number;
  feedSource: string;
  feedTitle: string | null;
  guid: string;
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
  mediaUrl: string | null;
  mediaDuration: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}): FeedItemResult {
  return {
    id: row.id,
    feedId: row.feedId,
    guid: row.guid,
    type: FEED_SOURCE_TO_ITEM_TYPE[row.feedSource] ?? row.feedSource,
    source: row.feedTitle?.trim() || row.feedSource,
    handle: row.feedTitle?.trim() || row.feedSource,
    time: formatRelativeTime(row.publishedAt),
    title: row.title,
    url: row.url,
    author: row.author,
    imageUrl: row.imageUrl,
    content: row.content,
    tags: row.tags,
    publishedAt: row.publishedAt,
    readAt: row.readAt,
    starred: row.starred,
    savedAt: row.savedAt,
    mediaUrl: row.mediaUrl,
    mediaDuration: row.mediaDuration,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    unread: row.readAt === null,
    saved: row.savedAt !== null,
  };
}

export async function fetchFeedItems(
  userId: number,
  query: FeedItemsQuery,
): Promise<FeedItemsPage> {
  const db = useDb();
  const limit = clampLimit(query.limit);
  const offset = resolveOffset(query.offset);

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
      mediaUrl: feedItems.mediaUrl,
      mediaDuration: feedItems.mediaDuration,
      createdAt: feedItems.createdAt,
      updatedAt: feedItems.updatedAt,
    })
    .from(feedItems)
    .innerJoin(feeds, eq(feedItems.feedId, feeds.id))
    .where(and(...feedItemsConditions(userId, query.filter)))
    .orderBy(sql`${feedItems.publishedAt} DESC NULLS LAST`, desc(feedItems.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextOffset = hasMore ? offset + limit : null;

  return {
    items: pageRows.map(mapRow),
    total: pageRows.length,
    nextOffset,
  };
}

// Whole-account totals per dashboard filter, so the sidebar chips reflect every
// matching item — not just the paginated page the client happens to hold. Keyed
// by filter id (feed.ts filterDefs): "all", each item type, plus "saved"/
// "starred".
export interface FeedFilterCounts {
  all: number;
  saved: number;
  starred: number;
  [itemType: string]: number;
}

// A conditional aggregate: how many owned rows satisfy `condition`. Cast to int
// so the Neon driver hands back a number rather than a bigint string.
function countWhere(condition: SQL): SQL<number> {
  return sql<number>`cast(count(*) filter (where ${condition}) as int)`;
}

// Postgres count() can surface as a bigint string over the HTTP driver; coerce
// so callers always get a real number.
function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// One grouped query returning every filter chip's total in a single row, so the
// dashboard counts stay whole-account-accurate independent of pagination. Each
// type total reuses feedSourcesForItemType, so a new source only needs one edit.
export async function fetchFeedItemCounts(
  userId: number,
): Promise<FeedFilterCounts> {
  const db = useDb();
  const itemTypes = [...new Set(Object.values(FEED_SOURCE_TO_ITEM_TYPE))];

  const selection: Record<string, SQL<number>> = {
    all: countWhere(sql`true`),
    saved: countWhere(savedStarredFilterCondition(SAVED_FILTER) as SQL),
    starred: countWhere(savedStarredFilterCondition(STARRED_FILTER) as SQL),
  };
  itemTypes.forEach((itemType) => {
    selection[itemType] = countWhere(
      inArray(feeds.source, feedSourcesForItemType(itemType)),
    );
  });

  const [row] = await db
    .select(selection)
    .from(feedItems)
    .innerJoin(feeds, eq(feedItems.feedId, feeds.id))
    .where(eq(feeds.userId, userId));

  const counts: FeedFilterCounts = {
    all: toCount(row?.all),
    saved: toCount(row?.saved),
    starred: toCount(row?.starred),
  };
  itemTypes.forEach((itemType) => {
    counts[itemType] = toCount(row?.[itemType]);
  });
  return counts;
}
