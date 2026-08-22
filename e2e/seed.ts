import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../server/db/schema";

export interface SeedResult {
  userId: number;
  feedId: number;
  feedItemIds: number[];
}

export async function seedE2eData(
  dbUrl: string,
  clerkProviderId: string,
): Promise<SeedResult> {
  const sql = neon(dbUrl);
  const db = drizzle(sql, { schema });

  const [user] = await db
    .insert(schema.users)
    .values({ providerId: clerkProviderId })
    .onConflictDoUpdate({
      target: schema.users.providerId,
      set: { updatedAt: new Date() },
    })
    .returning();

  await db
    .insert(schema.userSettings)
    .values({ userId: user.id })
    .onConflictDoNothing();

  const [feed] = await db
    .insert(schema.feeds)
    .values({
      userId: user.id,
      url: "https://e2e.example.com/feed.xml",
      title: "E2E Test Feed",
      source: "rss",
    })
    .onConflictDoUpdate({
      target: [schema.feeds.userId, schema.feeds.url],
      set: { updatedAt: new Date() },
    })
    .returning();

  const items = await db
    .insert(schema.feedItems)
    .values([
      {
        feedId: feed.id,
        guid: "e2e-item-1",
        title: "E2E Article One",
        url: "https://e2e.example.com/1",
        publishedAt: new Date(),
        // Saved (but not starred) so the Saved filter has exactly one match and
        // the Starred filter excludes it — exercising server-side filtering.
        savedAt: new Date(),
      },
      {
        feedId: feed.id,
        guid: "e2e-item-2",
        title: "E2E Article Two",
        url: "https://e2e.example.com/2",
        publishedAt: new Date(Date.now() - 3_600_000),
        // Starred (but not saved) so the Starred filter has exactly one match.
        starred: true,
      },
    ])
    .onConflictDoUpdate({
      target: [schema.feedItems.feedId, schema.feedItems.guid],
      set: { updatedAt: new Date() },
    })
    .returning();

  return {
    userId: user.id,
    feedId: feed.id,
    feedItemIds: items.map((i) => i.id),
  };
}

export async function truncateE2eData(dbUrl: string) {
  const sql = neon(dbUrl);
  const db = drizzle(sql, { schema });

  // Delete users — cascade handles feeds, feed_items, integrations, user_settings
  await db.delete(schema.users);
}
