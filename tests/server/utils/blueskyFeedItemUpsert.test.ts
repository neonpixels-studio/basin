import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../server/db/schema";
import { upsertBlueskyFeedItems } from "../../../server/utils/blueskyFeedItemUpsert";

// Runs the real Drizzle statement against in-memory Postgres so the coalesce
// expressions, the no-op guard, and the xmax insert detection are proven in
// SQL. Minimal DDL for the columns this statement touches; keep in sync with
// server/db/schema.ts. search_vector is plain text here since it is never set.
const SCHEMA_DDL = /* sql */ `
  CREATE TABLE feeds (id SERIAL PRIMARY KEY);
  CREATE TABLE feed_items (
    id SERIAL PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES feeds(id),
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    author TEXT,
    author_handle TEXT,
    image_url TEXT,
    content TEXT,
    tags TEXT[],
    published_at TIMESTAMP,
    read_at TIMESTAMP,
    starred BOOLEAN DEFAULT false,
    saved_at TIMESTAMP,
    media_url TEXT,
    media_duration INTEGER,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    search_vector TEXT,
    UNIQUE (feed_id, guid)
  );
`;

const FEED_ID = 1;
const GUID = "at://did:plc:abc/app.bsky.feed.post/1";

function post(overrides: Partial<typeof schema.feedItems.$inferInsert> = {}) {
  return {
    feedId: FEED_ID,
    guid: GUID,
    title: "Hello",
    author: "Alice",
    authorHandle: "alice.bsky.social",
    ...overrides,
  };
}

describe("upsertBlueskyFeedItems", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(SCHEMA_DDL);
    await client.exec(`INSERT INTO feeds (id) VALUES (${FEED_ID})`);
    db = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  async function storedRow() {
    const result = await client.query<Record<string, unknown>>(
      "SELECT author, author_handle, starred, title FROM feed_items WHERE guid = $1",
      [GUID],
    );
    return result.rows[0];
  }

  it("counts a fresh insert as new", async () => {
    expect(await upsertBlueskyFeedItems(db, [post()])).toBe(1);
    expect((await storedRow())?.author_handle).toBe("alice.bsky.social");
  });

  it("backfills a NULL handle on an existing row without counting it as new", async () => {
    await client.exec(
      `INSERT INTO feed_items (feed_id, guid, title, author, starred) VALUES (${FEED_ID}, '${GUID}', 'Original', NULL, true)`,
    );

    expect(await upsertBlueskyFeedItems(db, [post()])).toBe(0);

    expect(await storedRow()).toMatchObject({
      author: "Alice",
      author_handle: "alice.bsky.social",
      starred: true,
      title: "Original",
    });
  });

  it("keeps existing values when the incoming ones are missing", async () => {
    await upsertBlueskyFeedItems(db, [post()]);
    await upsertBlueskyFeedItems(db, [
      post({ author: null, authorHandle: null, title: "Changed" }),
    ]);

    expect(await storedRow()).toMatchObject({
      author: "Alice",
      author_handle: "alice.bsky.social",
      title: "Hello",
    });
  });

  it("collapses duplicate guids in one batch instead of throwing", async () => {
    const count = await upsertBlueskyFeedItems(db, [
      post({ author: "Old" }),
      post({ author: "New" }),
    ]);

    expect(count).toBe(1);
    expect((await storedRow())?.author).toBe("New");
  });

  it("returns 0 for an empty batch", async () => {
    expect(await upsertBlueskyFeedItems(db, [])).toBe(0);
  });
});
