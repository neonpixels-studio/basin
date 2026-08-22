import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  ACCOUNT_EXPORT_SCHEMA_VERSION,
  buildAccountExport,
  type AccountExportInput,
} from "../../../server/utils/accountExport";
import { feedItems, feeds } from "../../../server/db/schema";

// Internal/operational columns that are deliberately not part of the portable
// export: surrogate keys, the search index, row timestamps, and transient sync
// health. Anything else added to these tables must surface in the export, so a
// new column that is not listed here fails the coverage tests below.
const EXPORT_EXCLUDED_ITEM_COLUMNS = new Set([
  "id",
  "feedId",
  "searchVector",
  "createdAt",
  "updatedAt",
]);
const EXPORT_EXCLUDED_FEED_COLUMNS = new Set([
  "id",
  "userId",
  "syncStatus",
  "syncError",
  "syncFailedAt",
  "consecutiveFailures",
  "nextRetryAt",
  "updatedAt",
]);

const EXPORTED_AT = new Date("2026-08-13T12:00:00.000Z");
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const PUBLISHED_AT = new Date("2026-02-02T00:00:00.000Z");
const SAVED_AT = new Date("2026-03-03T00:00:00.000Z");

function baseInput(): AccountExportInput {
  return {
    user: { id: 1, providerId: "user_abc", createdAt: CREATED_AT },
    feeds: [
      {
        id: 10,
        url: "https://example.com/feed.xml",
        title: "Example Feed",
        description: "A feed",
        source: "rss",
        sourceOverride: null,
        paused: false,
        lastFetched: PUBLISHED_AT,
        createdAt: CREATED_AT,
      },
    ],
    savedItems: [
      {
        feedId: 10,
        guid: "guid-1",
        title: "Saved Article",
        url: "https://example.com/a",
        author: "Author",
        imageUrl: "https://example.com/a.png",
        content: "Body",
        tags: ["news"],
        publishedAt: PUBLISHED_AT,
        readAt: null,
        starred: true,
        savedAt: SAVED_AT,
        mediaUrl: null,
        mediaDuration: null,
      },
    ],
    settings: {
      showUnreadOnly: true,
      autoplayMediaPreviews: false,
      compactNotifications: false,
      theme: "dark",
      accentColor: "violet",
      readingFont: "serif",
      spacing: "cozy",
      radius: "sharp",
      layout: "timeline",
    },
    integrations: [
      {
        provider: "bluesky",
        providerAccountId: "did:plc:xyz",
        providerUsername: "handle.bsky.social",
        scopes: ["read"],
        createdAt: CREATED_AT,
      },
    ],
    exportedAt: EXPORTED_AT,
  };
}

describe("buildAccountExport", () => {
  it("emits the schema version and export timestamp", () => {
    const result = buildAccountExport(baseInput());
    expect(result.schemaVersion).toBe(ACCOUNT_EXPORT_SCHEMA_VERSION);
    expect(result.exportedAt).toBe("2026-08-13T12:00:00.000Z");
  });

  it("serializes account metadata without leaking the internal id", () => {
    const result = buildAccountExport(baseInput());
    expect(result.account).toEqual({
      providerId: "user_abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("serializes sources with ISO dates and stored state", () => {
    const result = buildAccountExport(baseInput());
    expect(result.sources).toEqual([
      {
        url: "https://example.com/feed.xml",
        title: "Example Feed",
        description: "A feed",
        source: "rss",
        sourceOverride: null,
        paused: false,
        lastFetched: "2026-02-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("joins each saved item to its feed and preserves stored content", () => {
    const result = buildAccountExport(baseInput());
    expect(result.savedItems[0]).toMatchObject({
      feedUrl: "https://example.com/feed.xml",
      feedTitle: "Example Feed",
      guid: "guid-1",
      title: "Saved Article",
      imageUrl: "https://example.com/a.png",
      starred: true,
      savedAt: "2026-03-03T00:00:00.000Z",
      publishedAt: "2026-02-02T00:00:00.000Z",
      readAt: null,
    });
  });

  it("falls back to null feed metadata for an orphaned saved item", () => {
    const input = baseInput();
    input.savedItems[0].feedId = 999;
    const result = buildAccountExport(input);
    expect(result.savedItems[0].feedUrl).toBeNull();
    expect(result.savedItems[0].feedTitle).toBeNull();
  });

  it("defaults a null starred flag to false", () => {
    const input = baseInput();
    input.savedItems[0].starred = null;
    const result = buildAccountExport(input);
    expect(result.savedItems[0].starred).toBe(false);
  });

  it("serializes settings when present", () => {
    const result = buildAccountExport(baseInput());
    expect(result.settings).toMatchObject({
      theme: "dark",
      showUnreadOnly: true,
    });
  });

  it("returns null settings when the user has none", () => {
    const input = baseInput();
    input.settings = null;
    const result = buildAccountExport(input);
    expect(result.settings).toBeNull();
  });

  it("serializes integrations without any token fields", () => {
    const result = buildAccountExport(baseInput());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
    expect(serialized).not.toContain("tokenSecret");
    expect(result.integrations[0]).toEqual({
      provider: "bluesky",
      providerAccountId: "did:plc:xyz",
      providerUsername: "handle.bsky.social",
      scopes: ["read"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("exports every non-internal saved-item column (guards against schema drift)", () => {
    const result = buildAccountExport(baseInput());
    const exported = new Set(Object.keys(result.savedItems[0]));

    for (const column of Object.keys(getTableColumns(feedItems))) {
      if (EXPORT_EXCLUDED_ITEM_COLUMNS.has(column)) {
        continue;
      }
      expect(exported).toContain(column);
    }
  });

  it("exports every non-internal feed column (guards against schema drift)", () => {
    const result = buildAccountExport(baseInput());
    const exported = new Set(Object.keys(result.sources[0]));

    for (const column of Object.keys(getTableColumns(feeds))) {
      if (EXPORT_EXCLUDED_FEED_COLUMNS.has(column)) {
        continue;
      }
      expect(exported).toContain(column);
    }
  });
});
