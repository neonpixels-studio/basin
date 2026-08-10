import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { feedItems, feeds } from "../db/schema";
import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";

// Dashboard filter ids that are not backed by a feed source: "all" applies no
// source restriction, "saved" restricts on savedAt rather than on the source.
export const ALL_FILTER = "all";
export const SAVED_FILTER = "saved";

export interface MarkAllReadOptions {
  // A dashboard filter id (feed.ts filterDefs). When omitted or "all", every
  // unread item in the account is marked read; otherwise the update is scoped
  // to that filter so a filtered "mark all read" only affects what it claims to.
  filter?: string;
}

// Reverse of FEED_SOURCE_TO_ITEM_TYPE: one item type can be produced by several
// feed sources (e.g. "tweet" from both "tweet" and "bluesky"), so map a filter's
// item type back to every feed source that yields it. Unknown types return [],
// which scopes the update to no feeds — an honest empty result, not a crash.
function feedSourcesForItemType(itemType: string): string[] {
  return Object.entries(FEED_SOURCE_TO_ITEM_TYPE)
    .filter(([, type]) => type === itemType)
    .map(([source]) => source);
}

// null means "no source restriction" (the "all" and "saved" views span every
// source); "saved" is narrowed later by savedAt, not by source.
function feedSourcesForFilter(filter: string | undefined): string[] | null {
  if (!filter || filter === ALL_FILTER || filter === SAVED_FILTER) {
    return null;
  }
  return feedSourcesForItemType(filter);
}

type MarkAllReadDb = ReturnType<typeof useDb>;

async function selectUserFeedIds(
  db: MarkAllReadDb,
  userId: number,
  filter: string | undefined,
): Promise<number[]> {
  const conditions = [eq(feeds.userId, userId)];
  const sources = feedSourcesForFilter(filter);
  if (sources) {
    conditions.push(inArray(feeds.source, sources));
  }
  const rows = await db
    .select({ id: feeds.id })
    .from(feeds)
    .where(and(...conditions));
  return rows.map((row) => row.id);
}

// Only the "saved" view narrows the update beyond feed ownership + unread.
function savedOnlyCondition(filter: string | undefined) {
  if (filter !== SAVED_FILTER) {
    return undefined;
  }
  return isNotNull(feedItems.savedAt);
}

// Account-scoped bulk mark-as-read: marks every unread feed item the user owns
// (optionally narrowed to the active dashboard filter) read in a single update,
// independent of what the client has paginated in. Returns the number of items
// actually flipped so the caller can report an honest count.
export async function markAllItemsRead(
  userId: number,
  options: MarkAllReadOptions = {},
): Promise<number> {
  const db = useDb();
  const feedIds = await selectUserFeedIds(db, userId, options.filter);
  if (feedIds.length === 0) {
    return 0;
  }

  const readAt = new Date();
  const updated = await db
    .update(feedItems)
    .set({ readAt })
    .where(
      and(
        inArray(feedItems.feedId, feedIds),
        isNull(feedItems.readAt),
        savedOnlyCondition(options.filter),
      ),
    )
    .returning({ id: feedItems.id });

  return updated.length;
}
