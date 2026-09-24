import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  feeds,
  feedItems,
  feedsRelations,
  feedItemsRelations,
  syncQueue,
} from "~/db/schema";
import { SYNC_QUEUE_STATUS } from "~/utils/syncQueueStatus";

const schema = {
  feeds,
  feedItems,
  feedsRelations,
  feedItemsRelations,
  syncQueue,
};
export type ClientDb = ReturnType<typeof drizzle<typeof schema>>;

let dbPromise: Promise<ClientDb> | null = null;

// DDL kept in sync with app/db/schema.ts — run once on first init. Exported
// so tests can stand up a real (in-memory) PGlite instance against the same
// DDL instead of hand-duplicating it — see tests/composables/syncQueueStore.test.ts.
export const MIGRATIONS = /* sql */ `
  CREATE TABLE IF NOT EXISTS feeds (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT,
    description TEXT,
    last_fetched TIMESTAMP,
    source     TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, url)
  );

  CREATE TABLE IF NOT EXISTS feed_items (
    id           SERIAL PRIMARY KEY,
    feed_id      INTEGER NOT NULL,
    guid         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    url          TEXT,
    content      TEXT,
    tags         TEXT[],
    published_at TIMESTAMP,
    read_at      TIMESTAMP,
    starred      BOOLEAN DEFAULT FALSE,
    saved_at     TIMESTAMP,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id         SERIAL PRIMARY KEY,
    action     TEXT NOT NULL,
    payload    TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT '${SYNC_QUEUE_STATUS.PENDING}',
    last_error TEXT,
    failed_at  TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    synced_at  TIMESTAMP
  );

  -- Local PGlite databases created before retry/quarantine tracking existed
  -- only have the columns above the CREATE TABLE originally shipped with —
  -- add the rest here so an existing IndexedDB store picks them up too.
  ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '${SYNC_QUEUE_STATUS.PENDING}';
  ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS last_error TEXT;
  ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;
`;

async function openClientDb(): Promise<ClientDb> {
  const client = new PGlite("idb://reader-app");
  await client.exec(MIGRATIONS);
  return drizzle(client, { schema });
}

// Memoizes the in-flight *promise*, not the resolved db — callers that both
// run early in boot (the sync plugin's boot flush and SyncQueueAlert's
// onMounted) can otherwise both see no db yet and each construct their own
// PGlite("idb://reader-app") against the same store, corrupting it. Every
// caller in the same tick-or-later now shares the one open in progress.
// Reset on failure so a transient open error (e.g. a blocked IndexedDB
// upgrade) doesn't cache a rejected promise forever — the next call gets a
// fresh attempt, matching the previous retry-on-next-call behavior.
export function useClientDb(): Promise<ClientDb> {
  if (!dbPromise) {
    dbPromise = openClientDb().catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
