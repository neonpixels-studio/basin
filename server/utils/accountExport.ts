// Builds the full-account data export the privacy page promises
// (app/pages/privacy.vue: "Export — download your sources and saved items").
// The OPML export only covers feed URLs; this serializer additionally covers
// saved/starred items, reading settings, and connected integrations so the
// data-portability promise is actually met.
//
// Kept as pure functions over already-fetched rows so the shape is testable
// without a database. Each input is a structural subset of its drizzle row —
// only the fields the export reads are typed, mirroring the hand-written row
// interfaces in feedItems.ts / search.ts. Integration secrets (access/refresh
// tokens, token secrets) are never in this input type — the caller must fetch
// integrations with those columns excluded (server/api/integrations.get.ts).

export const ACCOUNT_EXPORT_SCHEMA_VERSION = 1;
export const ACCOUNT_EXPORT_FILENAME = "reader-data-export.json";
export const ACCOUNT_EXPORT_MIME_TYPE = "application/json";

export interface AccountExportUser {
  providerId: string;
  createdAt: Date | null;
}

export interface AccountExportFeed {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  source: string;
  sourceOverride: string | null;
  paused: boolean;
  lastFetched: Date | null;
  createdAt: Date | null;
}

export interface AccountExportSavedItem {
  feedId: number;
  guid: string;
  title: string;
  url: string | null;
  author: string | null;
  imageUrl: string | null;
  content: string | null;
  tags: string[] | null;
  publishedAt: Date | null;
  readAt: Date | null;
  starred: boolean | null;
  savedAt: Date | null;
  mediaUrl: string | null;
  mediaDuration: number | null;
}

export interface AccountExportSettings {
  showUnreadOnly: boolean;
  autoplayMediaPreviews: boolean;
  compactNotifications: boolean;
  theme: string;
  accentColor: string;
  readingFont: string;
  spacing: string;
  radius: string;
  layout: string;
}

export interface AccountExportIntegration {
  provider: string;
  providerAccountId: string | null;
  providerUsername: string | null;
  scopes: string[] | null;
  createdAt: Date | null;
}

export interface AccountExportInput {
  user: AccountExportUser;
  feeds: AccountExportFeed[];
  savedItems: AccountExportSavedItem[];
  settings: AccountExportSettings | null;
  integrations: AccountExportIntegration[];
  exportedAt: Date;
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function serializeSource(feed: AccountExportFeed) {
  return {
    url: feed.url,
    title: feed.title,
    description: feed.description,
    source: feed.source,
    sourceOverride: feed.sourceOverride,
    paused: feed.paused,
    lastFetched: toIsoString(feed.lastFetched),
    createdAt: toIsoString(feed.createdAt),
  };
}

function serializeSavedItem(
  item: AccountExportSavedItem,
  feedsById: Map<number, AccountExportFeed>,
) {
  const feed = feedsById.get(item.feedId);
  return {
    feedUrl: feed?.url ?? null,
    feedTitle: feed?.title ?? null,
    guid: item.guid,
    title: item.title,
    url: item.url,
    author: item.author,
    imageUrl: item.imageUrl,
    content: item.content,
    tags: item.tags,
    publishedAt: toIsoString(item.publishedAt),
    readAt: toIsoString(item.readAt),
    starred: item.starred ?? false,
    savedAt: toIsoString(item.savedAt),
    mediaUrl: item.mediaUrl,
    mediaDuration: item.mediaDuration,
  };
}

function serializeSettings(settings: AccountExportSettings | null) {
  if (!settings) {
    return null;
  }
  return {
    showUnreadOnly: settings.showUnreadOnly,
    autoplayMediaPreviews: settings.autoplayMediaPreviews,
    compactNotifications: settings.compactNotifications,
    theme: settings.theme,
    accentColor: settings.accentColor,
    readingFont: settings.readingFont,
    spacing: settings.spacing,
    radius: settings.radius,
    layout: settings.layout,
  };
}

function serializeIntegration(integration: AccountExportIntegration) {
  return {
    provider: integration.provider,
    providerAccountId: integration.providerAccountId,
    providerUsername: integration.providerUsername,
    scopes: integration.scopes,
    createdAt: toIsoString(integration.createdAt),
  };
}

/**
 * Serializes a user's full account into a stable, JSON-safe export object.
 * Dates are emitted as ISO strings and integration secrets are never present
 * (the input type has no token fields, so they cannot leak through here).
 */
export function buildAccountExport(input: AccountExportInput) {
  const feedsById = new Map(input.feeds.map((feed) => [feed.id, feed]));

  return {
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    account: {
      providerId: input.user.providerId,
      createdAt: toIsoString(input.user.createdAt),
    },
    sources: input.feeds.map(serializeSource),
    savedItems: input.savedItems.map((item) =>
      serializeSavedItem(item, feedsById),
    ),
    settings: serializeSettings(input.settings),
    integrations: input.integrations.map(serializeIntegration),
  };
}
