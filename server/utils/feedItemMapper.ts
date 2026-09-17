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
// but not SearchResult's. Both mapSearchRow and mapRow now spread this
// function's single, explicitly-typed return value instead of re-deriving
// the fields by hand, so the four fields below can't be computed differently
// between the two paths again. The guarantee is one-directional: a
// SearchResult/FeedItemResult field this function doesn't produce is a
// missing-property compile error at the call site (the direction #247 broke
// in); a field only added here and never referenced by a result type is not
// itself an error, since TypeScript doesn't excess-property-check spread
// properties.
//
// Two call sites, not three — this deliberately abstracts before the rule of
// three, because the duplication had already caused a shipped bug (basin#247)
// rather than being merely repeated code; contrast search.ts's
// clampSearchLimit, which waits for a third caller because its duplication
// hasn't caused one.
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
