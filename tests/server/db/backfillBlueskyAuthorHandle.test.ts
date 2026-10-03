import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Runs the real 0018 backfill against in-memory Postgres so the permalink
// parsing and the row guards (bluesky only, NULL only) are proven in SQL, not
// through a mock. Minimal DDL for just the columns the migration reads/writes;
// keep in sync with server/db/schema.ts.
const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "server/db/migrations/0018_backfill_bluesky_author_handle.sql",
  ),
  "utf8",
);

const SCHEMA_DDL = /* sql */ `
  CREATE TABLE feeds (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL
  );
  CREATE TABLE feed_items (
    id SERIAL PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES feeds(id),
    url TEXT,
    author_handle TEXT
  );
`;

const BLUESKY_FEED_ID = 1;
const RSS_FEED_ID = 2;

async function handleFor(client: PGlite, itemId: number) {
  const result = await client.query<{ author_handle: string | null }>(
    "SELECT author_handle FROM feed_items WHERE id = $1",
    [itemId],
  );
  return result.rows[0]?.author_handle;
}

describe("0018 backfill_bluesky_author_handle", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(SCHEMA_DDL);
    await client.exec(`
      INSERT INTO feeds (id, source) VALUES (${BLUESKY_FEED_ID}, 'bluesky'), (${RSS_FEED_ID}, 'rss');
      INSERT INTO feed_items (id, feed_id, url, author_handle) VALUES
        (1, ${BLUESKY_FEED_ID}, 'https://bsky.app/profile/alice.bsky.social/post/3kabc', NULL),
        (2, ${BLUESKY_FEED_ID}, 'https://bsky.app/profile/bob.example.com/post/3kdef', 'existing.handle'),
        (3, ${RSS_FEED_ID}, 'https://bsky.app/profile/carol.bsky.social/post/3kghi', NULL),
        (4, ${BLUESKY_FEED_ID}, 'https://example.com/not-a-permalink', NULL),
        (5, ${BLUESKY_FEED_ID}, NULL, NULL);
    `);
    await client.exec(migrationSql);
  });

  afterEach(async () => {
    await client.close();
  });

  it("extracts the handle from the permalink of NULL bluesky rows", async () => {
    expect(await handleFor(client, 1)).toBe("alice.bsky.social");
  });

  it("does not overwrite an existing author_handle", async () => {
    expect(await handleFor(client, 2)).toBe("existing.handle");
  });

  it("ignores non-bluesky feeds", async () => {
    expect(await handleFor(client, 3)).toBeNull();
  });

  it("leaves rows with a non-permalink or missing url NULL", async () => {
    expect(await handleFor(client, 4)).toBeNull();
    expect(await handleFor(client, 5)).toBeNull();
  });
});
