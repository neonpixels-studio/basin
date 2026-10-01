import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { feedItems } from "../db/schema";

type FeedItemInsert = typeof feedItems.$inferInsert;

const incomingAuthor = sql`coalesce(excluded.author, ${feedItems.author})`;
const incomingAuthorHandle = sql`coalesce(excluded.author_handle, ${feedItems.authorHandle})`;

// A single INSERT ... ON CONFLICT DO UPDATE throws if two rows share a conflict
// key, so collapse duplicate guids first (last wins, freshest profile data).
function dedupeByGuid(items: FeedItemInsert[]): FeedItemInsert[] {
  return [
    ...new Map(
      items.map((item) => [`${item.feedId}:${item.guid}`, item]),
    ).values(),
  ];
}

// Bluesky rows synced before author_handle existed (or whose profile changed)
// are refreshed on conflict. Only author/authorHandle are written so user state
// (saved, starred, read) is never clobbered, and coalesce keeps an existing
// value when the incoming one is missing. The setWhere skips no-op writes.
// `xmax = 0` is true only for freshly inserted rows, so refreshed rows don't
// inflate the returned "new items" count.
export async function upsertBlueskyFeedItems(
  db: PgDatabase<PgQueryResultHKT, typeof import("../db/schema")>,
  items: FeedItemInsert[],
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }

  const result = await db
    .insert(feedItems)
    .values(dedupeByGuid(items))
    .onConflictDoUpdate({
      target: [feedItems.feedId, feedItems.guid],
      set: {
        author: incomingAuthor,
        authorHandle: incomingAuthorHandle,
      },
      setWhere: sql`${feedItems.author} is distinct from ${incomingAuthor} or ${feedItems.authorHandle} is distinct from ${incomingAuthorHandle}`,
    })
    .returning({ id: feedItems.id, inserted: sql<boolean>`(xmax = 0)` });

  return result.filter((row) => row.inserted).length;
}
