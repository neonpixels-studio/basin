import { parseRssFeedFromXml } from "./rssAdapter";
import type { NewFeedItem } from "./rssAdapter";

// Configurable so tests can point these at a local mock server.
const GOOGLE_TOKEN_URL =
  process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";

const YOUTUBE_SUBSCRIPTIONS_URL =
  process.env.YOUTUBE_SUBSCRIPTIONS_URL ??
  "https://www.googleapis.com/youtube/v3/subscriptions";

const YOUTUBE_CHANNEL_RSS_BASE =
  process.env.YOUTUBE_CHANNEL_RSS_BASE ??
  "https://www.youtube.com/feeds/videos.xml";

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

// Fetches the account's full subscription list, one page at a time. Exported
// (rather than kept private under fetchSubscriptionChannelIds below) so a
// caller that needs the channel title — e.g. integrationFeedCreation.ts,
// which uses it as the created feed's display name — doesn't have to
// re-fetch and re-paginate the same endpoint just to get a field this
// function already read off the response.
export async function fetchYouTubeSubscriptions(
  accessToken: string,
): Promise<YouTubeSubscription[]> {
  const subscriptions: YouTubeSubscription[] = [];
  let pageToken: string | undefined;

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

    pageToken = page.nextPageToken;
  } while (pageToken);

  return subscriptions;
}

export async function fetchSubscriptionChannelIds(
  accessToken: string,
): Promise<string[]> {
  const subscriptions = await fetchYouTubeSubscriptions(accessToken);
  return subscriptions.map((subscription) => subscription.channelId);
}

export async function fetchChannelRssXml(channelId: string): Promise<string> {
  const url = `${YOUTUBE_CHANNEL_RSS_BASE}?channel_id=${channelId}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!response.ok) {
    throw new Error(
      `Channel RSS fetch failed for ${channelId}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

export function filterItemsByWatermark(
  items: NewFeedItem[],
  lastSyncedAt: Date | null,
): NewFeedItem[] {
  if (!lastSyncedAt) {
    return items;
  }

  return items.filter(
    (item) => item.publishedAt !== null && item.publishedAt > lastSyncedAt,
  );
}

export async function fetchNewUploadsForChannel(
  channelId: string,
  feedId: number,
  channelTitle: string,
  lastSyncedAt: Date | null,
): Promise<NewFeedItem[]> {
  const xml = await fetchChannelRssXml(channelId);
  const allItems = await parseRssFeedFromXml(xml, feedId, channelTitle);
  return filterItemsByWatermark(allItems, lastSyncedAt);
}
