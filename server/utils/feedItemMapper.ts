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

// Fields derived identically wherever a feed-item row becomes a result —
// today the dashboard feed (feedItems.ts) and search (search.ts). Previously
// each file hand-rolled this derivation, which is how `unread` drifted out of
// sync between them (basin#247): the field existed on FeedItemResult's mapper
// but not SearchResult's. That direction is now a hard compile error — a
// field declared on SearchResult/FeedItemResult that this function doesn't
// produce fails the object-literal check in mapSearchRow/mapRow — since both
// spread this function's single, explicitly-typed return value instead of
// re-deriving the fields by hand.
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
