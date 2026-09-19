import { eq, isNotNull, type SQL } from "drizzle-orm";
import { feedItems } from "../db/schema";
import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";

// Dashboard filter ids that are not backed by a feed source: "all" applies no
// restriction; "saved" restricts on savedAt and "starred" on the starred
// column, rather than on the source.
export const ALL_FILTER = "all";
export const SAVED_FILTER = "saved";
export const STARRED_FILTER = "starred";

// Every filter id the feed endpoints accept: the non-source views plus each item
// type produced by a known feed source. Anything else is rejected up front (fail
// loud) rather than silently filtering to nothing.
export const VALID_FEED_FILTERS = new Set<string>([
  ALL_FILTER,
  SAVED_FILTER,
  STARRED_FILTER,
  ...Object.values(FEED_SOURCE_TO_ITEM_TYPE),
]);

// Reverse of FEED_SOURCE_TO_ITEM_TYPE: one item type can be produced by several
// feed sources (e.g. "tweet" from both "tweet" and "bluesky"), so map a filter's
// item type back to every feed source that yields it. Unknown types return [],
// which scopes to no feeds — an honest empty result, not a crash.
export function feedSourcesForItemType(itemType: string): string[] {
  return Object.entries(FEED_SOURCE_TO_ITEM_TYPE)
    .filter(([, type]) => type === itemType)
    .map(([source]) => source);
}

// null means "no source restriction" (the "all", "saved" and "starred" views
// span every source); "saved"/"starred" are narrowed later by their own column,
// not by source.
export function feedSourcesForFilter(
  filter: string | undefined,
): string[] | null {
  if (
    !filter ||
    filter === ALL_FILTER ||
    filter === SAVED_FILTER ||
    filter === STARRED_FILTER
  ) {
    return null;
  }
  return feedSourcesForItemType(filter);
}

// The "saved" and "starred" views narrow a query beyond feed ownership: "saved"
// to items with a savedAt, "starred" to starred items. Every other filter (all,
// or a type filter) returns undefined so drizzle's `and()` drops it.
export function savedStarredFilterCondition(
  filter: string | undefined,
): SQL | undefined {
  if (filter === SAVED_FILTER) {
    return isNotNull(feedItems.savedAt);
  }
  if (filter === STARRED_FILTER) {
    return eq(feedItems.starred, true);
  }
  return undefined;
}
