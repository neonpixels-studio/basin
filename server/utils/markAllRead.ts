import { and, eq, inArray, isNull } from "drizzle-orm";
import type { useDb } from "../db/index";
import { feedItems, feeds } from "../db/schema";
import {
  VALID_FEED_FILTERS,
  feedSourcesForFilter,
  savedStarredFilterCondition,
} from "./feedFilters";

// The mark-all-read endpoint accepts the same dashboard filter ids as the feed
// listing. Re-exported under the historical name so existing callers keep
// working while the definition lives in one place (feedFilters).
export const VALID_MARK_ALL_READ_FILTERS = VALID_FEED_FILTERS;

export interface MarkAllReadOptions {
  // A dashboard filter id (feed.ts filterDefs). When omitted or "all", every
  // unread item in the account is marked read; otherwise the update is scoped
  // to that filter so a filtered "mark all read" only affects what it claims to.
  filter?: string;
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

// Account-scoped bulk mark-as-read: marks every unread feed item the user owns
// (optionally narrowed to the active dashboard filter) read in a single update,
// independent of what the client has paginated in. No .returning() — the count
// is unused by callers and streaming one row per marked item back over the Neon
// HTTP driver defeats the point of an intentionally unbounded operation.
export async function markAllItemsRead(
  userId: number,
  options: MarkAllReadOptions = {},
): Promise<void> {
  const db = useDb();
  const feedIds = await selectUserFeedIds(db, userId, options.filter);
  if (feedIds.length === 0) {
    return;
  }

  const readAt = new Date();
  await db
    .update(feedItems)
    .set({ readAt })
    .where(
      and(
        inArray(feedItems.feedId, feedIds),
        isNull(feedItems.readAt),
        savedStarredFilterCondition(options.filter),
      ),
    );
}
