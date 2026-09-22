import type { NewFeedItem } from "./rssAdapter";

// Configurable so tests can point these at a local mock server.
const GOOGLE_TOKEN_URL =
  process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";

const YOUTUBE_SUBSCRIPTIONS_URL =
  process.env.YOUTUBE_SUBSCRIPTIONS_URL ??
  "https://www.googleapis.com/youtube/v3/subscriptions";

const YOUTUBE_PLAYLIST_ITEMS_URL =
  process.env.YOUTUBE_PLAYLIST_ITEMS_URL ??
  "https://www.googleapis.com/youtube/v3/playlistItems";

export interface YouTubeCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface RefreshedTokens {
  accessToken: string;
  expiresAt: Date;
}

export interface TokenRefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface SubscriptionItem {
  snippet: {
    resourceId: {
      channelId: string;
    };
    title: string;
  };
}

export interface SubscriptionsPage {
  items?: SubscriptionItem[];
  nextPageToken?: string;
}

// Google's token endpoint returns 400 (invalid_grant — the refresh token
// was revoked, expired from inactivity, or the user changed their password)
// or 401 (invalid_client) for a refresh token that can never succeed again.
// Any other status (5xx, rate limiting) is treated as transient by the
// caller instead.
const AUTH_FAILURE_STATUS_CODES = new Set([400, 401]);

export class TokenRefreshAuthError extends Error {
  status: number;

  constructor(status: number, statusText: string) {
    super(`Token refresh failed: ${status} ${statusText}`);
    this.name = "TokenRefreshAuthError";
    this.status = status;
  }
}

export function isTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) {
    return true;
  }

  // Refresh 60 seconds early to avoid races at the boundary.
  const EXPIRY_BUFFER_MS = 60_000;
  return Date.now() >= expiresAt.getTime() - EXPIRY_BUFFER_MS;
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<RefreshedTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    if (AUTH_FAILURE_STATUS_CODES.has(response.status)) {
      throw new TokenRefreshAuthError(response.status, response.statusText);
    }
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TokenRefreshResponse;

  if (!data.access_token) {
    throw new Error("Token refresh response missing access_token");
  }

  if (!Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error("Token refresh response missing/invalid expires_in");
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  return { accessToken: data.access_token, expiresAt };
}

export interface YouTubeSubscription {
  channelId: string;
  title: string;
}

// Bounds how many pages (50 subscriptions each) this fetches before giving up
// and returning what it has. Without a cap, an account with hundreds of
// subscriptions costs one sequential round trip per page inside whatever
// synchronous request is calling this (the OAuth connect callback) — see
// integrationFeedCreation.ts's own YOUTUBE_FEED_INSERT_CHUNK_SIZE comment for
// the DB half of the same timeout risk. 1000 channels is comfortably above
// any real account.
const MAX_SUBSCRIPTION_PAGES = 20;

// Fetches the account's subscription list, one page at a time, up to
// MAX_SUBSCRIPTION_PAGES. Exported (rather than kept private under
// fetchSubscriptionChannelIds below) so a caller that needs the channel
// title — e.g. integrationFeedCreation.ts, which uses it as the created
// feed's display name — doesn't have to re-fetch and re-paginate the same
// endpoint just to get a field this function already read off the response.
export async function fetchYouTubeSubscriptions(
  accessToken: string,
): Promise<YouTubeSubscription[]> {
  const subscriptions: YouTubeSubscription[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;

  do {
    const params = new URLSearchParams({
      part: "snippet",
      mine: "true",
      maxResults: "50",
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(`${YOUTUBE_SUBSCRIPTIONS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(
        `Subscriptions API error: ${response.status} ${response.statusText}`,
      );
    }

    const page = (await response.json()) as SubscriptionsPage;

    for (const item of page.items ?? []) {
      subscriptions.push({
        channelId: item.snippet.resourceId.channelId,
        title: item.snippet.title,
      });
    }

    pagesFetched += 1;
    pageToken = page.nextPageToken;

    if (pageToken && pagesFetched >= MAX_SUBSCRIPTION_PAGES) {
      console.error(
        `fetchYouTubeSubscriptions: stopped after ${MAX_SUBSCRIPTION_PAGES} pages (${subscriptions.length} channels); more subscriptions remain unfetched.`,
      );
      break;
    }
  } while (pageToken);

  return subscriptions;
}

export async function fetchSubscriptionChannelIds(
  accessToken: string,
): Promise<string[]> {
  const subscriptions = await fetchYouTubeSubscriptions(accessToken);
  return subscriptions.map((subscription) => subscription.channelId);
}

export interface PlaylistItemSnippet {
  title?: string;
  description?: string;
  publishedAt?: string;
  channelTitle?: string;
  resourceId: {
    videoId: string;
  };
  thumbnails?: {
    high?: { url: string };
    medium?: { url: string };
    default?: { url: string };
  };
}

export interface PlaylistItemContentDetails {
  // The actual video publish time, as opposed to snippet.publishedAt (when
  // the video was added to the uploads playlist). These usually match, but
  // diverge for premieres/scheduled uploads, where the playlist add time can
  // land before the video is actually public — see mapPlaylistItemToFeedItem.
  videoPublishedAt?: string;
}

export interface PlaylistItem {
  snippet: PlaylistItemSnippet;
  contentDetails?: PlaylistItemContentDetails;
}

export interface PlaylistItemsPage {
  items?: PlaylistItem[];
  nextPageToken?: string;
}

// YouTube caps playlistItems.list pages at 50 results; requesting the max
// minimizes how many pages (and quota units — 1 each) are needed to reach
// the watermark.
const PAGE_LIMIT = 50;

// Safety cap mirroring blueskyAdapter's MAX_PAGES: bounds how many pages a
// single sync will walk before giving up, so a channel with a very old or
// missing watermark (first sync, or one that backed off for a long time via
// feedSyncBackoff.ts, which can push retries out to 24h) can't turn this into
// an unbounded loop inside the serverless sync function. 20 pages * 50 items
// = up to 1000 uploads per sync, comfortably above any realistic gap between
// syncs.
const MAX_PAGES = 20;

const CHANNEL_ID_PREFIX = "UC";
const UPLOADS_PLAYLIST_PREFIX = "UU";

// Every YouTube channel's "uploads" playlist id is derivable from the channel
// id by swapping its UC prefix for UU — YouTube's own documented convention
// — which avoids a separate channels.list round trip (and its own quota
// unit) just to look the playlist id up.
export function uploadsPlaylistIdForChannel(channelId: string): string {
  if (!channelId.startsWith(CHANNEL_ID_PREFIX)) {
    throw new Error(
      `Cannot derive uploads playlist id: channel id "${channelId}" does not start with "${CHANNEL_ID_PREFIX}"`,
    );
  }

  return UPLOADS_PLAYLIST_PREFIX + channelId.slice(CHANNEL_ID_PREFIX.length);
}

// Isolated network call so fetchNewUploadsForChannel's pagination/watermark
// logic can be unit-tested against canned pages instead of a live API.
export async function fetchChannelUploadsPage(
  playlistId: string,
  accessToken: string,
  pageToken?: string,
): Promise<PlaylistItemsPage> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId,
    maxResults: String(PAGE_LIMIT),
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const response = await fetch(`${YOUTUBE_PLAYLIST_ITEMS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Channel uploads fetch failed for playlist ${playlistId}: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as PlaylistItemsPage;
}

function resolveThumbnailUrl(
  thumbnails: PlaylistItemSnippet["thumbnails"],
): string | null {
  return (
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    null
  );
}

function resolveUploadPublishedAt(
  publishedAt: string | undefined,
): Date | null {
  if (!publishedAt) {
    return null;
  }

  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Exported for unit testing. Uses the "yt:video:<id>" guid format the old
// Atom-feed <id> element produced, so switching from the RSS feed to this API
// call doesn't re-insert every video a prior RSS-backed sync already stored
// (feedItems dedupes on (feedId, guid)).
export function mapPlaylistItemToFeedItem(
  item: PlaylistItem,
  feedId: number,
  channelTitle: string,
): NewFeedItem {
  const { snippet } = item;
  const videoId = snippet.resourceId.videoId;
  // Prefer the actual video publish time over the playlist-add time (see
  // PlaylistItemContentDetails) so a premiere/scheduled upload added to the
  // playlist before it went public isn't dated too early.
  const publishedAt =
    item.contentDetails?.videoPublishedAt ?? snippet.publishedAt;

  return {
    feedId,
    guid: `yt:video:${videoId}`,
    title: snippet.title ?? "(untitled)",
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: snippet.channelTitle ?? channelTitle,
    content: snippet.description || null,
    imageUrl: resolveThumbnailUrl(snippet.thumbnails),
    publishedAt: resolveUploadPublishedAt(publishedAt),
    savedAt: null,
    readAt: null,
    starred: false,
    tags: null,
    searchVector: null,
  };
}

// True once a dated item's publish time has caught up to (or passed) the
// watermark — pagination stops here, since the uploads playlist is newest
// first.
function isPastWatermark(feedItem: NewFeedItem, watermark: Date): boolean {
  return feedItem.publishedAt != null && feedItem.publishedAt <= watermark;
}

// An item with no resolvable publish date can't be placed relative to the
// watermark, so — matching the previous filterItemsByWatermark semantics —
// it's excluded from the results once a watermark exists. Unlike
// isPastWatermark, this must never stop pagination: an undated item earlier
// in a page (e.g. a livestream still missing contentDetails) says nothing
// about whether older, dated items remain further down the playlist.
function isExcludedByMissingDate(
  feedItem: NewFeedItem,
  watermark: Date | null,
): boolean {
  return watermark != null && feedItem.publishedAt == null;
}

interface PageCollectionResult {
  items: NewFeedItem[];
  reachedWatermark: boolean;
}

// Maps and filters one page's worth of playlist items: drops malformed
// entries (deleted/unavailable videos can come back without a resourceId),
// stops at the first item that has caught up to the watermark, and excludes
// (without stopping) any item whose publish date can't be resolved — see
// isPastWatermark/isExcludedByMissingDate for why those are different.
function collectPageItems(
  pageItems: PlaylistItem[],
  feedId: number,
  channelTitle: string,
  lastSyncedAt: Date | null,
): PageCollectionResult {
  const items: NewFeedItem[] = [];

  for (const item of pageItems) {
    if (!item.snippet?.resourceId?.videoId) {
      continue;
    }

    const feedItem = mapPlaylistItemToFeedItem(item, feedId, channelTitle);

    if (lastSyncedAt && isPastWatermark(feedItem, lastSyncedAt)) {
      return { items, reachedWatermark: true };
    }

    if (isExcludedByMissingDate(feedItem, lastSyncedAt)) {
      continue;
    }

    items.push(feedItem);
  }

  return { items, reachedWatermark: false };
}

// Logs (rather than throwing) when the MAX_PAGES cap is hit before the
// watermark or the end of the playlist, mirroring fetchYouTubeSubscriptions's
// own stopped-early warning — the sync still returns what it collected, but
// an operator needs a signal that this channel's history outran the cap.
function warnIfTruncated(
  channelId: string,
  pagesFetched: number,
  reachedWatermark: boolean,
  hasNextPage: boolean,
): void {
  if (reachedWatermark || !hasNextPage || pagesFetched < MAX_PAGES) {
    return;
  }

  console.error(
    `fetchNewUploadsForChannel: stopped after ${MAX_PAGES} pages for channel ${channelId}; more uploads may remain unfetched.`,
  );
}

// Paginates the channel's uploads playlist (newest first) via the YouTube
// Data API, stopping once a page's items reach lastSyncedAt or the API runs
// out of pages — mirroring fetchNewBlueskyPosts's cursor walk in
// blueskyAdapter.ts. The previous implementation read the channel's public
// RSS feed (videos.xml), which only ever returns the 15 most recent uploads
// with no way to page past that fixed window; a channel that posted more
// than 15 videos between two syncs (or one that backed off via
// feedSyncBackoff.ts, which can push retries out to 24h) silently lost the
// overflow forever. This calls an authenticated endpoint, so it needs a
// valid OAuth access token — the youtube.readonly scope already granted at
// connect time (see buildYouTubeAuthUrl in google.ts) covers it, so no new
// credential or external service is required.
export async function fetchNewUploadsForChannel(
  channelId: string,
  feedId: number,
  channelTitle: string,
  lastSyncedAt: Date | null,
  accessToken: string,
): Promise<NewFeedItem[]> {
  const playlistId = uploadsPlaylistIdForChannel(channelId);
  const items: NewFeedItem[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;

  while (pagesFetched < MAX_PAGES) {
    const page = await fetchChannelUploadsPage(
      playlistId,
      accessToken,
      pageToken,
    );
    pagesFetched += 1;

    const pageItems = page.items ?? [];
    if (pageItems.length === 0) {
      break;
    }

    const { items: pageResults, reachedWatermark } = collectPageItems(
      pageItems,
      feedId,
      channelTitle,
      lastSyncedAt,
    );
    items.push(...pageResults);

    warnIfTruncated(
      channelId,
      pagesFetched,
      reachedWatermark,
      Boolean(page.nextPageToken),
    );

    if (reachedWatermark || !page.nextPageToken) {
      break;
    }

    pageToken = page.nextPageToken;
  }

  return items;
}
