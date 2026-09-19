import { FEED_SOURCE_TO_ITEM_TYPE } from "../../app/utils/feedSources";
import { formatRelativeTime } from "../../app/utils/feedTime";

// The raw columns every feed-item row->shape mapper derives from, shared by
// search.ts's SearchRow and feedItems.ts's row type. Both are structurally
// compatible with this (rather than declaring `extends`) so this file stays
// the single place that lists which raw columns feed the derivation below.
export interface FeedItemDerivationInput {
  feedSource: string;
  feedTitle: string | null;
  publishedAt: Date | null;
  readAt: Date | null;
  savedAt: Date | null;
}

// Shared by feedItems.ts's mapRow and search.ts's mapSearchRow so the two
// can't derive these fields differently again — basin#247 (`unread`) and
// basin#281 (`saved`) both drifted between the two mappers before landing
// here. FeedItemResult and SearchResult both `extends` this interface
// (rather than redeclaring these fields), so a field added here is a
// missing-property compile error on both result types until each mapper's
// return statement is updated to supply it.
export interface FeedItemDerivedFields {
  // Derived from the parent feed's source column — matches SOURCES keys in icons.js
  type: string;
  // Human-readable feed title for display
  source: string;
  // Short relative time string (e.g. "2h", "3d")
  time: string;
  // True when the item has never been opened/read
  unread: boolean;
  // True when the item has been bookmarked/saved
  saved: boolean;
}

export function deriveFeedItemFields(
  row: FeedItemDerivationInput,
): FeedItemDerivedFields {
  return {
    type: FEED_SOURCE_TO_ITEM_TYPE[row.feedSource] ?? row.feedSource,
    source: row.feedTitle?.trim() || row.feedSource,
    time: formatRelativeTime(row.publishedAt),
    unread: row.readAt === null,
    saved: row.savedAt !== null,
  };
}
