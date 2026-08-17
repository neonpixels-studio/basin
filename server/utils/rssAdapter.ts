import RssParser from "rss-parser";
import type { InferInsertModel } from "drizzle-orm";
import { feedItems } from "../db/schema";
import { MAX_ITEMS_PER_SYNC } from "../../netlify/functions/types";
import { resolvePublicFeedUrl } from "./urlValidator";
import { normalizeTags } from "./tagNormalizer";

export type NewFeedItem = Omit<
  InferInsertModel<typeof feedItems>,
  "id" | "createdAt" | "updatedAt"
>;

// Media RSS (used by YouTube Atom feeds) carries the item body in
// media:group > media:description rather than <content>/<description>.
// rss-parser only surfaces namespaced elements when told to via customFields.
interface MediaNode {
  _?: unknown;
}

interface MediaGroup {
  "media:description"?: Array<string | MediaNode>;
}

type MediaItemFields = { mediaGroup?: MediaGroup };
type MediaRssItem = RssParser.Item & MediaItemFields;

// Tell rss-parser to surface the namespaced media:group element as `mediaGroup`,
// and to copy raw <category> nodes into `categories` for Atom entries — the
// built-in parser only populates categories for RSS, so without this Atom/YouTube
// feeds would never expose their categories to tag extraction. keepArray keeps
// every category (the parser default takes only the first element).
const CUSTOM_ITEM_FIELDS: Array<
  [string, string] | [string, string, { keepArray: boolean }]
> = [
  ["media:group", "mediaGroup"],
  ["category", "categories", { keepArray: true }],
];

const parser = new RssParser<Record<string, unknown>, MediaItemFields>({
  timeout: 10_000,
  customFields: {
    item: CUSTOM_ITEM_FIELDS,
  },
});

function hashString(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    const character = input.charCodeAt(index);
    hash = (hash << 5) - hash + character;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function resolveGuid(item: RssParser.Item): string {
  if (item.guid) {
    return item.guid;
  }

  if (item.link) {
    return hashString(item.link);
  }

  const stableSeed = [
    item.title ?? "",
    item.isoDate ?? "",
    item.pubDate ?? "",
    item.contentSnippet ?? "",
    item.content ?? "",
  ].join("|");

  return stableSeed ? hashString(stableSeed) : "(missing-guid)";
}

function resolvePublishedAt(
  isoDate: string | undefined,
  pubDate: string | undefined,
): Date | null {
  const raw = isoDate ?? pubDate;
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function resolveImageUrl(
  item: RssParser.Item,
  feedImageUrl: string | undefined,
): string | null {
  if (item.enclosure?.type?.startsWith("image/")) {
    return item.enclosure.url ?? null;
  }

  if (feedImageUrl) {
    return feedImageUrl;
  }

  return null;
}

function extractMediaDescription(item: MediaRssItem): string | null {
  const node = item.mediaGroup?.["media:description"]?.[0];
  // A plain text element parses to a string; one with attributes
  // (e.g. media:description type="plain") parses to { _: text, $: attrs },
  // mirroring rss-parser's own `._` unwrap for nested nodes.
  const description = typeof node === "string" ? node : node?._;
  if (typeof description !== "string") {
    return null;
  }
  return description.trim() || null;
}

function mapItemToFeedItem(
  item: MediaRssItem,
  feedId: number,
  feedTitle: string | undefined,
  feedImageUrl: string | undefined,
): NewFeedItem {
  const guid = resolveGuid(item);
  const publishedAt = resolvePublishedAt(item.isoDate, item.pubDate);
  const author = item.creator ?? feedTitle ?? null;
  const content =
    item.contentSnippet ?? item.content ?? extractMediaDescription(item);
  const imageUrl = resolveImageUrl(item, feedImageUrl);

  return {
    feedId,
    guid,
    title: item.title ?? "(untitled)",
    url: item.link ?? null,
    author,
    content,
    imageUrl,
    publishedAt,
    savedAt: null,
    readAt: null,
    starred: false,
    tags: normalizeTags(item.categories),
    searchVector: null,
  };
}

// DNS-resolving SSRF guard, shared with feed discovery and feed creation
// (see resolvePublicFeedUrl in server/utils/urlValidator.ts for the exact
// guarantee and its known TOCTOU limitation). This runs immediately before
// parser.parseURL on every sync — not just when the feed was first added —
// so a hostname that DNS-rebinds to a private address after add time is
// caught on the next scheduled sync rather than being fetched indefinitely.
export async function assertSafeFeedUrl(url: string): Promise<void> {
  await resolvePublicFeedUrl(url);
}

export async function parseRssFeed(
  url: string,
  feedId: number,
): Promise<NewFeedItem[]> {
  await assertSafeFeedUrl(url);
  const feed = await parser.parseURL(url);
  const feedImageUrl = feed.image?.url;

  const recentItems = (feed.items ?? []).slice(0, MAX_ITEMS_PER_SYNC);

  return recentItems.map((item) =>
    mapItemToFeedItem(item, feedId, feed.title, feedImageUrl),
  );
}

export async function parseRssFeedFromXml(
  xml: string,
  feedId: number,
  feedTitle?: string,
): Promise<NewFeedItem[]> {
  const feed = await parser.parseString(xml);
  const feedImageUrl = feed.image?.url;

  const recentItems = (feed.items ?? []).slice(0, MAX_ITEMS_PER_SYNC);

  return recentItems.map((item) =>
    mapItemToFeedItem(item, feedId, feedTitle ?? feed.title, feedImageUrl),
  );
}
