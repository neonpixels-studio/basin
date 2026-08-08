import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FREE_PLAN_FEED_LIMIT } from "../../../server/utils/planLimits";
import {
  FEED_LIMIT_DB_ERROR_MARKER,
  FEED_LIMIT_SQLSTATE,
  isFeedLimitDbError,
} from "../../../server/utils/feedLimit";

// Asserted via substring (toThrow/toContain), built from the app's constant so
// renaming the marker without updating the migration breaks these tests (and
// would otherwise silently make isFeedLimitDbError stop matching in production).

// Exercises the real DB-level source-cap guard (the trigger shipped in
// migration 0011_enforce_source_cap.sql) against an in-memory Postgres, so the
// guarantee is proven at the layer that actually enforces it — not through a
// mock that can't run a trigger. These assertions fail if the trigger is
// removed or the cap literal drifts, which is the whole point of the DB
// backstop: the over-cap insert is rejected even when the app-level count is
// bypassed entirely (as a raced concurrent add would bypass it).

// vitest runs with the repo root as cwd, so resolve the migration from there.
const migrationSql = readFileSync(
  resolve(process.cwd(), "server/db/migrations/0011_enforce_source_cap.sql"),
  "utf8",
);

// Minimal DDL for just the tables the trigger reads (feeds, subscriptions) plus
// the users they reference. Kept small and local rather than replaying the full
// migration chain under PGlite — the earlier migrations use tsvector/GIN and
// other features the in-memory harness doesn't reliably support, and the trigger
// only touches these three tables. The columns the trigger reads (user_id, url,
// plan) must stay in sync with server/db/schema.ts.
const SCHEMA_DDL = /* sql */ `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY
  );
  CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    plan TEXT NOT NULL DEFAULT 'free'
  );
  CREATE TABLE feeds (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    source_override TEXT,
    UNIQUE (user_id, url)
  );
`;

const USER_ID = 1;
// A second user, pre-loaded past the cap, so the trigger's `WHERE user_id`
// clauses are exercised: if the count or subscription check ignored user_id,
// this user's feeds would leak into USER_ID's count and flip the assertions.
const OTHER_USER_ID = 2;

async function freshDb() {
  const client = new PGlite();
  await client.exec(SCHEMA_DDL);
  // Split on drizzle's statement breakpoints so each DDL statement runs alone.
  for (const statement of migrationSql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) {
      await client.exec(trimmed);
    }
  }
  await client.query("INSERT INTO users (id) VALUES ($1), ($2)", [
    USER_ID,
    OTHER_USER_ID,
  ]);
  await seedOtherUserOverCap(client);
  return client;
}

async function seedOtherUserOverCap(client: PGlite) {
  // Pro so the trigger lets this user hold more than the cap; that way if the
  // count or subscription check dropped `WHERE user_id`, this user's rows would
  // bleed into USER_ID's checks and flip the assertions below.
  await client.query(
    "INSERT INTO subscriptions (user_id, plan) VALUES ($1, 'pro')",
    [OTHER_USER_ID],
  );
  for (let index = 0; index <= FREE_PLAN_FEED_LIMIT; index++) {
    await client.query(
      "INSERT INTO feeds (user_id, url, source) VALUES ($1, $2, 'rss')",
      [OTHER_USER_ID, `https://other.example.com/feed-${index}.xml`],
    );
  }
}

async function addSource(client: PGlite, url: string) {
  // Mirrors createFeedForUser's upsert so re-adds resolve to an UPDATE, not a
  // unique-constraint error, exactly as the app add path does.
  await client.query(
    `INSERT INTO feeds (user_id, url, source)
     VALUES ($1, $2, 'rss')
     ON CONFLICT (user_id, url) DO UPDATE SET source = EXCLUDED.source`,
    [USER_ID, url],
  );
}

async function fillToCap(client: PGlite) {
  for (let index = 0; index < FREE_PLAN_FEED_LIMIT; index++) {
    await addSource(client, `https://example.com/feed-${index}.xml`);
  }
}

async function makePro(client: PGlite) {
  await client.query(
    "INSERT INTO subscriptions (user_id, plan) VALUES ($1, 'pro')",
    [USER_ID],
  );
}

describe("source cap DB trigger (migration 0011, real PGlite)", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = await freshDb();
  });

  afterEach(async () => {
    // Each test builds a fresh in-process WASM instance; close it so they don't
    // pile up for the rest of the run.
    await client.close();
  });

  it("allows a Free user to reach exactly the cap", async () => {
    await expect(fillToCap(client)).resolves.toBeUndefined();
    const result = await client.query<{ value: number }>(
      "SELECT count(*)::int AS value FROM feeds WHERE user_id = $1",
      [USER_ID],
    );
    expect(result.rows[0].value).toBe(FREE_PLAN_FEED_LIMIT);
  });

  it("rejects the add that would put a Free user over the cap with SQLSTATE 23514", async () => {
    await fillToCap(client);
    const error = await addSource(
      client,
      "https://example.com/one-too-many.xml",
    ).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ code: FEED_LIMIT_SQLSTATE });
    expect((error as Error).message).toContain(FEED_LIMIT_DB_ERROR_MARKER);
    // Close the loop: the real predicate must recognize the real driver error.
    expect(isFeedLimitDbError(error)).toBe(true);
  });

  it("rejects a single batched multi-row insert that would exceed the cap", async () => {
    // A BEFORE-INSERT row trigger can't see sibling rows of the same statement,
    // so a batched insert would slip past a count taken per row. The AFTER
    // trigger counts the fully-applied statement and rolls the whole batch back.
    const values = Array.from(
      { length: FREE_PLAN_FEED_LIMIT + 5 },
      (_unused, index) =>
        `(${USER_ID}, 'https://example.com/batch-${index}.xml', 'rss')`,
    ).join(", ");
    await expect(
      client.query(`INSERT INTO feeds (user_id, url, source) VALUES ${values}`),
    ).rejects.toThrow(FEED_LIMIT_DB_ERROR_MARKER);
    const result = await client.query<{ value: number }>(
      "SELECT count(*)::int AS value FROM feeds WHERE user_id = $1",
      [USER_ID],
    );
    expect(result.rows[0].value).toBe(0);
  });

  it("takes the per-user advisory lock for a Free add and skips it for Pro", async () => {
    // Proves the serialization mechanism exists (deleting the lock line drops
    // the Free count to 0) and that the Pro fast path never serializes. True
    // multi-connection concurrency can't run under single-connection PGlite.
    async function advisoryLocksDuringAdd(userId: number, label: string) {
      await client.exec("BEGIN");
      await client.query(
        "INSERT INTO feeds (user_id, url, source) VALUES ($1, $2, 'rss')",
        [userId, `https://example.com/lock-${label}.xml`],
      );
      const held = await client.query<{ value: number }>(
        `SELECT count(*)::int AS value FROM pg_locks
         WHERE locktype = 'advisory'
           AND classid = hashtext('feeds_source_cap')
           AND objid = $1`,
        [userId],
      );
      await client.exec("COMMIT");
      return held.rows[0].value;
    }

    // USER_ID is Free (no subscription); OTHER_USER_ID is Pro (seeded).
    expect(await advisoryLocksDuringAdd(USER_ID, "free")).toBeGreaterThan(0);
    expect(await advisoryLocksDuringAdd(OTHER_USER_ID, "pro")).toBe(0);
  });

  it("does not classify an unrelated DB error as a cap rejection", async () => {
    await addSource(client, "https://example.com/feed-0.xml");
    // A plain duplicate insert (no ON CONFLICT) raises a real unique_violation,
    // not the cap trigger — the predicate must not treat it as a 403.
    const error = await client
      .query(
        "INSERT INTO feeds (user_id, url, source) VALUES ($1, $2, 'rss')",
        [USER_ID, "https://example.com/feed-0.xml"],
      )
      .catch((thrown: unknown) => thrown);
    expect(isFeedLimitDbError(error)).toBe(false);
  });

  it("still lets a capped Free user re-add a source they already follow", async () => {
    await fillToCap(client);
    await expect(
      addSource(client, "https://example.com/feed-0.xml"),
    ).resolves.toBeUndefined();
  });

  it("lets a Pro user add sources beyond the Free cap", async () => {
    await makePro(client);
    await fillToCap(client);
    await expect(
      addSource(client, "https://example.com/beyond-cap.xml"),
    ).resolves.toBeUndefined();
  });

  it("still caps a user whose subscription row is on the free plan", async () => {
    await client.query(
      "INSERT INTO subscriptions (user_id, plan) VALUES ($1, 'free')",
      [USER_ID],
    );
    await fillToCap(client);
    await expect(
      addSource(client, "https://example.com/one-too-many.xml"),
    ).rejects.toThrow(FEED_LIMIT_DB_ERROR_MARKER);
  });
});
