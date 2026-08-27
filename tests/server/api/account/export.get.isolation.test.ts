import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, count, eq, isNotNull, or } from "drizzle-orm";
import * as schema from "../../../../server/db/schema";
import { SYNC_STATUS } from "../../../../server/utils/syncStatus";
import handler from "../../../../server/api/account/export.get";

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Proves cross-tenant isolation of the account export at the layer that
// actually enforces it — the handler wiring the authenticated user id into its
// queries — rather than at the query-builder layer (export.get.test.ts already
// pins the drizzle clauses). Here two users are seeded into a real in-process
// Postgres (PGlite) and the handler is invoked as one of them; only that user's
// rows may come back. If any ownership guard in server/api/account/export.get.ts
// were dropped (the feeds-owned-by-user subquery feeding inArray, the per-user
// feeds/integrations filters, or the per-user settings lookup), the other
// tenant's saved items, sources, integrations, or settings would leak into the
// export and these assertions would fail — which a mock of useDb can never
// catch, since a mock returns whatever rows the test hands it.

const SOURCE_RSS = "rss";
const SAVED_SUFFIX = "saved";
const STARRED_SUFFIX = "starred";
// A second starred, null-published item, inserted after the first so it gets a
// higher id — exercises the handler's `desc(feedItems.id)` tiebreaker among
// null-published rows (it must sort ahead of the lower-id starred item).
const STARRED_LATER_SUFFIX = "starred-later";
const UNSAVED_SUFFIX = "unsaved";
// The app writes integrations.provider as a plain literal (server/api/auth/
// bluesky.post.ts); it is not the feed-source vocabulary, so this is a local
// literal, not the BLUESKY_SOURCE feed-source constant.
const INTEGRATION_PROVIDER = "bluesky";

// Minimal DDL for the five tables the export handler reads, kept local rather
// than replaying the full migration chain under PGlite (earlier migrations use
// GIN indexes and triggers the in-memory harness doesn't reliably support — see
// tests/server/db/sourceCap.test.ts). Every column each table defines in
// server/db/schema.ts is present because the drizzle relational query selects
// all of them by name — so a column added to the schema but not here fails
// loudly in seeding/query with the offending column named, not silently. Only
// column names must stay in sync; indexes, triggers, and ON DELETE behavior are
// intentionally omitted since the export only reads, but NOT NULL and DEFAULT
// are kept because the fixtures rely on them (e.g. feed_items.starred DEFAULT
// false is what makes the unsaved row excluded, and user_settings defaults
// populate the non-null fields the serializer reads). search_vector is a bare
// tsvector column (no GIN index/trigger, unused here).
const SCHEMA_DDL = /* sql */ `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    provider_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
  );
  CREATE TABLE feeds (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    last_fetched TIMESTAMP,
    source TEXT NOT NULL,
    source_override TEXT,
    sync_status TEXT NOT NULL DEFAULT '${SYNC_STATUS.OK}',
    sync_error TEXT,
    sync_failed_at TIMESTAMP,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP,
    paused BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
  );
  CREATE TABLE feed_items (
    id SERIAL PRIMARY KEY,
    feed_id INTEGER NOT NULL REFERENCES feeds(id),
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    author TEXT,
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
    search_vector tsvector
  );
  CREATE TABLE integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_secret TEXT,
    expires_at TIMESTAMP,
    scopes TEXT[],
    provider_account_id TEXT,
    provider_username TEXT,
    sync_status TEXT NOT NULL DEFAULT '${SYNC_STATUS.OK}',
    sync_error TEXT,
    sync_failed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
  );
  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    show_unread_only BOOLEAN NOT NULL DEFAULT false,
    autoplay_media_previews BOOLEAN NOT NULL DEFAULT false,
    compact_notifications BOOLEAN NOT NULL DEFAULT false,
    theme TEXT NOT NULL DEFAULT 'system',
    accent_color TEXT NOT NULL DEFAULT 'violet',
    reading_font TEXT NOT NULL DEFAULT 'serif',
    spacing TEXT NOT NULL DEFAULT 'cozy',
    radius TEXT NOT NULL DEFAULT 'sharp',
    layout TEXT NOT NULL DEFAULT 'timeline',
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
  );
`;

interface Tenant {
  providerId: string;
  feedUrl: string;
  guidPrefix: string;
  // A user_settings value distinct per tenant, so a leaked settings row shows up
  // as the wrong theme in the export rather than passing silently.
  theme: string;
}

const TENANT_A: Tenant = {
  providerId: "user_a_export_isolation",
  feedUrl: "https://a.example.com/feed.xml",
  guidPrefix: "a",
  theme: "dark",
};

const TENANT_B: Tenant = {
  providerId: "user_b_export_isolation",
  feedUrl: "https://b.example.com/feed.xml",
  guidPrefix: "b",
  theme: "light",
};

interface SeededTenant {
  user: typeof schema.users.$inferSelect;
  // The expected saved items in export order: the published item first (DESC
  // NULLS LAST), then the two null-published starred items newest-id first
  // (the handler's `desc(feedItems.id)` tiebreaker). Doubles as the ownership
  // check — it is exactly this tenant's saved+starred set, nothing else.
  savedGuids: string[];
}

function guidFor(tenant: Tenant, suffix: string): string {
  return `${tenant.guidPrefix}-${suffix}`;
}

// Four items per tenant: one saved-via-savedAt (with publishedAt), two starred
// with null publishedAt, one neither. The unsaved one must never appear. Only
// the saved item carries a publishedAt so `publishedAt DESC NULLS LAST` is
// exercised (it sorts ahead of the null-published rows), and the two starred
// items — inserted in order so `starred-later` gets the higher id — exercise
// the `desc(feedItems.id)` tiebreaker among null-published rows.
function itemsForFeed(feedId: number, tenant: Tenant) {
  return [
    {
      feedId,
      guid: guidFor(tenant, SAVED_SUFFIX),
      title: `${tenant.guidPrefix} saved`,
      savedAt: new Date("2026-03-01T00:00:00.000Z"),
      publishedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
    {
      feedId,
      guid: guidFor(tenant, STARRED_SUFFIX),
      title: `${tenant.guidPrefix} starred`,
      starred: true,
    },
    {
      feedId,
      guid: guidFor(tenant, STARRED_LATER_SUFFIX),
      title: `${tenant.guidPrefix} starred later`,
      starred: true,
    },
    {
      feedId,
      guid: guidFor(tenant, UNSAVED_SUFFIX),
      title: `${tenant.guidPrefix} unsaved`,
    },
  ];
}

async function seedTenant(
  database: Database,
  tenant: Tenant,
): Promise<SeededTenant> {
  const [user] = await database
    .insert(schema.users)
    .values({ providerId: tenant.providerId })
    .returning();
  const [feed] = await database
    .insert(schema.feeds)
    .values({ userId: user.id, url: tenant.feedUrl, source: SOURCE_RSS })
    .returning();
  await database.insert(schema.feedItems).values(itemsForFeed(feed.id, tenant));
  // Integrations and settings are also per-user in the export; seed one of each
  // so a missing ownership filter on those queries leaks the other tenant's
  // connected account or settings, not just saved items. (Token-column exclusion
  // is a separate concern, covered by export.get.test.ts.)
  await database.insert(schema.integrations).values({
    userId: user.id,
    provider: INTEGRATION_PROVIDER,
    accessToken: `token-${tenant.guidPrefix}`,
    providerAccountId: tenant.providerId,
  });
  await database
    .insert(schema.userSettings)
    .values({ userId: user.id, theme: tenant.theme });
  return {
    user,
    savedGuids: [
      guidFor(tenant, SAVED_SUFFIX),
      guidFor(tenant, STARRED_LATER_SUFFIX),
      guidFor(tenant, STARRED_SUFFIX),
    ],
  };
}

function eventFor(user: unknown) {
  return { context: { user } };
}

let client: PGlite;
let database: Database;

// The handler resolves useDb() and setHeader() as Nuxt auto-imported globals;
// point useDb at the live PGlite-backed drizzle instance and no-op setHeader.
// useDb is a spy so a test can prove the auth guard runs before any query.
const useDbSpy = vi.fn(() => database);
vi.stubGlobal("useDb", useDbSpy);
vi.stubGlobal("setHeader", vi.fn());

describe("GET /api/account/export cross-tenant isolation (real PGlite)", () => {
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(SCHEMA_DDL);
    database = drizzle(client, { schema });
    tenantA = await seedTenant(database, TENANT_A);
    tenantB = await seedTenant(database, TENANT_B);
  });

  afterEach(async () => {
    await client.close();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an unauthenticated request before touching the database", async () => {
    // Seeding uses the drizzle instance directly, not the useDb() global, so a
    // clean spy here means the handler never queried before throwing 401.
    useDbSpy.mockClear();
    await expect(handler(eventFor(null))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(useDbSpy).not.toHaveBeenCalled();
  });

  it("returns exactly the requesting tenant's saved items, in export order", async () => {
    const result = await handler(eventFor(tenantA.user));
    const exportedGuids = result.savedItems.map((item) => item.guid);

    // Exact ordered equality: the set is precisely tenant A's saved+starred
    // guids (so no tenant-B guid and no unsaved guid can be present), and the
    // order pins the published-before-null ordering the handler applies.
    expect(exportedGuids).toEqual(tenantA.savedGuids);
  });

  it("scopes every exported saved item, source, integration, and setting to the requesting tenant", async () => {
    const result = await handler(eventFor(tenantA.user));

    // Exact array (not `.every`, which is vacuously true on an empty result):
    // every one of tenant A's saved items carries A's feed url and nothing else.
    expect(result.savedItems.map((item) => item.feedUrl)).toEqual(
      tenantA.savedGuids.map(() => TENANT_A.feedUrl),
    );
    expect(result.sources.map((source) => source.url)).toEqual([
      TENANT_A.feedUrl,
    ]);
    expect(result.account.providerId).toBe(TENANT_A.providerId);
    // Integrations carry connected-account identity; an unfiltered findMany
    // would return both tenants' rows, so this asserts only tenant A's.
    expect(
      result.integrations.map((integration) => integration.providerAccountId),
    ).toEqual([TENANT_A.providerId]);
    // Assert A's theme here and B's theme in the reverse test: settings use an
    // order-less findFirst, so an unscoped lookup returns one arbitrary row for
    // both requests — only asserting both distinct values reliably catches it.
    expect(result.settings?.theme).toBe(TENANT_A.theme);
  });

  it("excludes another tenant's rows and settings, proving the filter (not empty data) does the work", async () => {
    // Guard against a false pass: tenant A (the tenant NOT making the request)
    // genuinely owns saved rows in the same database, so their absence below can
    // only be the ownership filter, never empty data.
    const [{ value: otherTenantSavedCount }] = await database
      .select({ value: count() })
      .from(schema.feedItems)
      .innerJoin(schema.feeds, eq(schema.feedItems.feedId, schema.feeds.id))
      .where(
        and(
          eq(schema.feeds.userId, tenantA.user.id),
          or(
            isNotNull(schema.feedItems.savedAt),
            eq(schema.feedItems.starred, true),
          ),
        ),
      );
    expect(otherTenantSavedCount).toBe(tenantA.savedGuids.length);

    const result = await handler(eventFor(tenantB.user));

    expect(result.savedItems.map((item) => item.guid)).toEqual(
      tenantB.savedGuids,
    );
    // Assert the reverse direction for sources and integrations too: a bug that
    // always returned the first-seeded tenant (A) would pass the tenant-A test
    // and slip through here without these. (account.providerId is a serializer
    // passthrough of event.context.user, not a query, so it's a sanity check,
    // not isolation coverage.)
    expect(result.sources.map((source) => source.url)).toEqual([
      TENANT_B.feedUrl,
    ]);
    expect(
      result.integrations.map((integration) => integration.providerAccountId),
    ).toEqual([TENANT_B.providerId]);
    expect(result.account.providerId).toBe(TENANT_B.providerId);
    // Paired with the tenant-A theme assertion: A expects "dark", B expects
    // "light", so an unscoped findFirst returning one arbitrary row fails one
    // direction or the other.
    expect(result.settings?.theme).toBe(TENANT_B.theme);
  });
});
