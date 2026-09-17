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
}

// Shared by feedItems.ts's mapRow and search.ts's mapSearchRow so the two
// can't derive these fields differently again (basin#247, where `unread`
// drifted between them). Both spread this function's return value; a field
// declared on SearchResult/FeedItemResult that this function doesn't produce
// is a missing-property compile error at the call site.
export interface FeedItemDerivedFields {
  // Derived from the parent feed's source column — matches SOURCES keys in icons.js
  type: string;
  // Human-readable feed title for display
  source: string;
  // Short relative time string (e.g. "2h", "3d")
  time: string;
  unread: boolean;
}

export function deriveFeedItemFields(
  row: FeedItemDerivationInput,
): FeedItemDerivedFields {
  return {
    type: FEED_SOURCE_TO_ITEM_TYPE[row.feedSource] ?? row.feedSource,
    source: row.feedTitle?.trim() || row.feedSource,
    time: formatRelativeTime(row.publishedAt),
    unread: row.readAt === null,
  };
}
