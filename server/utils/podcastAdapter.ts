import RssParser from "rss-parser";
import { MAX_ITEMS_PER_SYNC } from "../../netlify/functions/types";
import { assertSafeFeedUrl, type NewFeedItem } from "./rssAdapter";
import { normalizeTags } from "./tagNormalizer";

// iTunes namespace fields we pull from each item.
interface ItunesItemFields {
  "itunes:duration"?: string;
  "itunes:image"?: { $?: { href?: string } } | string;
  "itunes:episode"?: string;
  "itunes:season"?: string;
  "itunes:explicit"?: string;
  "itunes:summary"?: string;
}

// iTunes namespace fields we pull from the channel/feed.
interface ItunesFeedFields {
  "itunes:image"?: { $?: { href?: string } } | string;
}

type PodcastItem = RssParser.Item & ItunesItemFields;
type PodcastFeed = RssParser.Output<ItunesItemFields> & ItunesFeedFields;

// rss-parser needs to be told which custom fields to extract.
const ITUNES_ITEM_FIELDS: Array<[string, { keepArray: boolean }]> = [
  ["itunes:duration", { keepArray: false }],
  ["itunes:image", { keepArray: false }],
  ["itunes:episode", { keepArray: false }],
  ["itunes:season", { keepArray: false }],
  ["itunes:explicit", { keepArray: false }],
  ["itunes:summary", { keepArray: false }],
];

const ITUNES_FEED_FIELDS: Array<[string, { keepArray: boolean }]> = [
  ["itunes:image", { keepArray: false }],
];

const podcastParser = new RssParser<ItunesFeedFields, ItunesItemFields>({
  timeout: 10_000,
  customFields: {
    feed: ITUNES_FEED_FIELDS as any,
    item: ITUNES_ITEM_FIELDS as any,
  },
});

// Duration normalization: handles HH:MM:SS, MM:SS, and raw seconds.
// Returns null when the input is absent or unparseable.
export function normalizeDurationToSeconds(
  raw: string | undefined,
): number | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return isNaN(seconds) ? null : seconds;
  }

  const parts = trimmed.split(":").map((part) => parseInt(part, 10));

  if (parts.some(isNaN) || parts.some((part) => part < 0)) {
    return null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

function extractItunesImageHref(
  field: { $?: { href?: string } } | string | undefined,
): string | null {
  if (!field) {
    return null;
  }

  if (typeof field === "string") {
    return field || null;
  }

  return field.$?.href ?? null;
}

// Resolve the episode image: episode-level itunes:image takes precedence,
// falling back to the channel-level itunes:image.
function resolveEpisodeImageUrl(
  item: PodcastItem,
  channelItunesImage: { $?: { href?: string } } | string | undefined,
): string | null {
  const episodeImage = extractItunesImageHref(item["itunes:image"]);
  if (episodeImage) {
    return episodeImage;
  }

  return extractItunesImageHref(channelItunesImage);
}

function resolveGuid(item: PodcastItem): string {
  if (item.guid) {
    return item.guid;
  }

  if (item.enclosure?.url) {
    return hashString(item.enclosure.url);
  }

  const stableSeed = [
    item.title ?? "",
    item.isoDate ?? "",
    item.pubDate ?? "",
  ].join("|");

  return stableSeed ? hashString(stableSeed) : "(missing-guid)";
}

function hashString(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    const character = input.charCodeAt(index);
    hash = (hash << 5) - hash + character;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
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

function resolveContent(item: PodcastItem): string | null {
  return (
    item["itunes:summary"] ??
    item.contentSnippet ??
    item.content ??
    item.summary ??
    null
  );
}

function mapItemToFeedItem(
  item: PodcastItem,
  feedId: number,
  feedTitle: string | undefined,
  channelItunesImage: { $?: { href?: string } } | string | undefined,
): NewFeedItem {
  const guid = resolveGuid(item);
  const publishedAt = resolvePublishedAt(item.isoDate, item.pubDate);
  const imageUrl = resolveEpisodeImageUrl(item, channelItunesImage);
  const mediaDuration = normalizeDurationToSeconds(item["itunes:duration"]);

  return {
    feedId,
    guid,
    title: item.title ?? "(untitled)",
    url: item.link ?? null,
    author: feedTitle ?? null,
    content: resolveContent(item),
    imageUrl,
    publishedAt,
    savedAt: null,
    readAt: null,
    starred: false,
    tags: normalizeTags(item.categories),
    searchVector: null,
    mediaUrl: item.enclosure?.url ?? null,
    mediaDuration,
  };
}

export async function parsePodcastFeed(
  url: string,
  feedId: number,
): Promise<NewFeedItem[]> {
  await assertSafeFeedUrl(url);
  const feed = (await podcastParser.parseURL(url)) as PodcastFeed;
  const channelItunesImage = feed["itunes:image"];

  const recentItems = (feed.items ?? []).slice(0, MAX_ITEMS_PER_SYNC);

  return recentItems.map((item) =>
    mapItemToFeedItem(
      item as PodcastItem,
      feedId,
      feed.title,
      channelItunesImage,
    ),
  );
}

export async function parsePodcastFeedFromXml(
  xml: string,
  feedId: number,
  feedTitle?: string,
): Promise<NewFeedItem[]> {
  const feed = (await podcastParser.parseString(xml)) as PodcastFeed;
  const channelItunesImage = feed["itunes:image"];

  const recentItems = (feed.items ?? []).slice(0, MAX_ITEMS_PER_SYNC);

  return recentItems.map((item) =>
    mapItemToFeedItem(
      item as PodcastItem,
      feedId,
      feedTitle ?? feed.title,
      channelItunesImage,
    ),
  );
}
