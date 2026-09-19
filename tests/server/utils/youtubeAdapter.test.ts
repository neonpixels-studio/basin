import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist all mock factories so they can be referenced in vi.mock() calls.
const { mockParseRssFeedFromXml } = vi.hoisted(() => ({
  mockParseRssFeedFromXml: vi.fn(),
}));

vi.mock("../../../server/utils/rssAdapter", () => ({
  parseRssFeedFromXml: mockParseRssFeedFromXml,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  isTokenExpired,
  refreshAccessToken,
  fetchYouTubeSubscriptions,
  fetchSubscriptionChannelIds,
  fetchChannelRssXml,
  filterItemsByWatermark,
  fetchNewUploadsForChannel,
  TokenRefreshAuthError,
} from "../../../server/utils/youtubeAdapter";
import type { NewFeedItem } from "../../../server/utils/rssAdapter";

function makeFeedItem(overrides: Partial<NewFeedItem> = {}): NewFeedItem {
  return {
    feedId: 1,
    guid: "yt-abc123",
    title: "Test Video",
    url: "https://youtube.com/watch?v=abc123",
    author: "Test Channel",
    content: "Video description",
    imageUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    publishedAt: new Date("2024-06-01T12:00:00Z"),
    savedAt: null,
    readAt: null,
    starred: false,
    tags: null,
    searchVector: null,
    ...overrides,
  };
}

// --- isTokenExpired ---

describe("isTokenExpired", () => {
  it("returns true when expiresAt is null", () => {
    expect(isTokenExpired(null)).toBe(true);
  });

  it("returns true when the token expires within the 60-second buffer", () => {
    const soonToExpire = new Date(Date.now() + 30_000);
    expect(isTokenExpired(soonToExpire)).toBe(true);
  });

  it("returns false when the token has plenty of time remaining", () => {
    const future = new Date(Date.now() + 3_600_000);
    expect(isTokenExpired(future)).toBe(false);
  });

  it("returns true when the token is already past its expiry", () => {
    const past = new Date(Date.now() - 1000);
    expect(isTokenExpired(past)).toBe(true);
  });
});

// --- refreshAccessToken ---

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("posts to the Google token endpoint and returns parsed tokens", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
    });

    const result = await refreshAccessToken(
      "refresh-token",
      "client-id",
      "client-secret",
    );

    expect(result.accessToken).toBe("new-access-token");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sends the correct grant_type and refresh_token in the request body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
    });

    await refreshAccessToken("my-refresh", "cid", "csecret");

    const body = mockFetch.mock.calls[0][1].body.toString();
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=my-refresh");
    expect(body).toContain("client_id=cid");
    expect(body).toContain("client_secret=csecret");
  });

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(
      refreshAccessToken("bad-refresh", "cid", "csec"),
    ).rejects.toThrow("Token refresh failed: 401");
  });

  it("throws TokenRefreshAuthError for a 400 (invalid_grant — revoked/expired refresh token)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    await expect(
      refreshAccessToken("bad-refresh", "cid", "csec"),
    ).rejects.toBeInstanceOf(TokenRefreshAuthError);
  });

  it("throws TokenRefreshAuthError for a 401 (invalid_client)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(
      refreshAccessToken("bad-refresh", "cid", "csec"),
    ).rejects.toBeInstanceOf(TokenRefreshAuthError);
  });

  it("throws a plain Error (not TokenRefreshAuthError) for a 5xx — treated as transient by the caller", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const rejection = refreshAccessToken("refresh", "cid", "csec");
    await expect(rejection).rejects.toThrow("Token refresh failed: 503");
    await expect(rejection).rejects.not.toBeInstanceOf(TokenRefreshAuthError);
  });

  it("throws when the response body is missing access_token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: "invalid_grant" }),
    });

    await expect(refreshAccessToken("revoked", "cid", "csec")).rejects.toThrow(
      "missing access_token",
    );
  });

  it("throws when expires_in is missing from the response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok" }),
    });

    await expect(refreshAccessToken("r", "c", "s")).rejects.toThrow(
      "missing/invalid expires_in",
    );
  });

  it("throws when expires_in is zero or negative", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "tok",
          expires_in: 0,
          token_type: "Bearer",
        }),
    });

    await expect(refreshAccessToken("r", "c", "s")).rejects.toThrow(
      "missing/invalid expires_in",
    );
  });

  it("throws when expires_in is non-numeric", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "tok",
          expires_in: "not-a-number",
          token_type: "Bearer",
        }),
    });

    await expect(refreshAccessToken("r", "c", "s")).rejects.toThrow(
      "missing/invalid expires_in",
    );
  });

  it("sets expiresAt approximately expires_in seconds from now", async () => {
    const before = Date.now();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "tok",
          expires_in: 7200,
          token_type: "Bearer",
        }),
    });

    const result = await refreshAccessToken("r", "c", "s");
    const after = Date.now();

    const expiryMs = result.expiresAt.getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + 7200_000);
    expect(expiryMs).toBeLessThanOrEqual(after + 7200_000);
  });
});

// --- fetchYouTubeSubscriptions ---

describe("fetchYouTubeSubscriptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns channel id and title pairs from a single page of subscriptions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              snippet: {
                resourceId: { channelId: "UC111" },
                title: "Channel A",
              },
            },
            {
              snippet: {
                resourceId: { channelId: "UC222" },
                title: "Channel B",
              },
            },
          ],
        }),
    });

    const subscriptions = await fetchYouTubeSubscriptions("access-token");
    expect(subscriptions).toEqual([
      { channelId: "UC111", title: "Channel A" },
      { channelId: "UC222", title: "Channel B" },
    ]);
  });

  it("paginates across multiple pages", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                snippet: { resourceId: { channelId: "UC001" }, title: "Ch 1" },
              },
            ],
            nextPageToken: "page2token",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                snippet: { resourceId: { channelId: "UC002" }, title: "Ch 2" },
              },
            ],
          }),
      });

    const subscriptions = await fetchYouTubeSubscriptions("access-token");
    expect(subscriptions).toEqual([
      { channelId: "UC001", title: "Ch 1" },
      { channelId: "UC002", title: "Ch 2" },
    ]);
  });

  it("stops after MAX_SUBSCRIPTION_PAGES instead of paginating forever", async () => {
    // A never-ending nextPageToken (every page always claims more exist)
    // must not turn this into an unbounded loop inside the synchronous OAuth
    // callback that calls it.
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              { snippet: { resourceId: { channelId: "UC1" }, title: "Ch" } },
            ],
            nextPageToken: "always-more",
          }),
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const subscriptions = await fetchYouTubeSubscriptions("access-token");

    expect(subscriptions).toHaveLength(20);
    expect(mockFetch).toHaveBeenCalledTimes(20);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("stopped after 20 pages"),
    );
  });
});

// --- fetchSubscriptionChannelIds ---

describe("fetchSubscriptionChannelIds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns channel IDs from a single page of subscriptions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              snippet: {
                resourceId: { channelId: "UC111" },
                title: "Channel A",
              },
            },
            {
              snippet: {
                resourceId: { channelId: "UC222" },
                title: "Channel B",
              },
            },
          ],
        }),
    });

    const channelIds = await fetchSubscriptionChannelIds("access-token");
    expect(channelIds).toEqual(["UC111", "UC222"]);
  });

  it("paginates and collects IDs across multiple pages", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                snippet: { resourceId: { channelId: "UC001" }, title: "Ch 1" },
              },
            ],
            nextPageToken: "page2token",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                snippet: { resourceId: { channelId: "UC002" }, title: "Ch 2" },
              },
            ],
          }),
      });

    const channelIds = await fetchSubscriptionChannelIds("access-token");
    expect(channelIds).toEqual(["UC001", "UC002"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("passes the pageToken on subsequent requests", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              { snippet: { resourceId: { channelId: "UC001" }, title: "C" } },
            ],
            nextPageToken: "nextToken",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [] }),
      });

    await fetchSubscriptionChannelIds("token");

    const secondCallUrl = mockFetch.mock.calls[1][0];
    expect(secondCallUrl).toContain("pageToken=nextToken");
  });

  it("sends the Bearer access token in the Authorization header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    await fetchSubscriptionChannelIds("my-access-token");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Authorization: "Bearer my-access-token" },
      }),
    );
  });

  it("returns an empty array when there are no subscriptions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const channelIds = await fetchSubscriptionChannelIds("token");
    expect(channelIds).toEqual([]);
  });

  it("throws when the API returns an error status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(fetchSubscriptionChannelIds("bad-token")).rejects.toThrow(
      "Subscriptions API error: 403",
    );
  });
});

// --- fetchChannelRssXml ---

describe("fetchChannelRssXml", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches the XML for the given channel ID", async () => {
    const xmlContent = "<feed><entry><title>Video 1</title></entry></feed>";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xmlContent),
    });

    const result = await fetchChannelRssXml("UC12345");
    expect(result).toBe(xmlContent);
  });

  it("requests the correct YouTube RSS URL with the channel_id param", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<feed/>"),
    });

    await fetchChannelRssXml("UCxyz");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("channel_id=UCxyz"),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it("throws when the response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(fetchChannelRssXml("UC999")).rejects.toThrow(
      "Channel RSS fetch failed for UC999: 404",
    );
  });
});

// --- filterItemsByWatermark ---

describe("filterItemsByWatermark", () => {
  it("returns all items when lastSyncedAt is null", () => {
    const items = [
      makeFeedItem({ publishedAt: new Date("2024-01-01T00:00:00Z") }),
      makeFeedItem({
        guid: "b",
        publishedAt: new Date("2023-12-01T00:00:00Z"),
      }),
    ];

    expect(filterItemsByWatermark(items, null)).toHaveLength(2);
  });

  it("keeps only items published after lastSyncedAt", () => {
    const watermark = new Date("2024-05-01T00:00:00Z");
    const items = [
      makeFeedItem({
        guid: "new",
        publishedAt: new Date("2024-06-01T00:00:00Z"),
      }),
      makeFeedItem({
        guid: "old",
        publishedAt: new Date("2024-04-01T00:00:00Z"),
      }),
      makeFeedItem({
        guid: "exact",
        publishedAt: new Date("2024-05-01T00:00:00Z"),
      }),
    ];

    const filtered = filterItemsByWatermark(items, watermark);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].guid).toBe("new");
  });

  it("excludes items with null publishedAt when a watermark is set", () => {
    const watermark = new Date("2024-01-01T00:00:00Z");
    const items = [
      makeFeedItem({ guid: "nodatevid", publishedAt: null }),
      makeFeedItem({
        guid: "datedvid",
        publishedAt: new Date("2024-02-01T00:00:00Z"),
      }),
    ];

    const filtered = filterItemsByWatermark(items, watermark);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].guid).toBe("datedvid");
  });

  it("returns an empty array when all items predate the watermark", () => {
    const watermark = new Date("2024-12-01T00:00:00Z");
    const items = [
      makeFeedItem({ publishedAt: new Date("2024-01-01T00:00:00Z") }),
      makeFeedItem({
        guid: "b",
        publishedAt: new Date("2024-06-01T00:00:00Z"),
      }),
    ];

    expect(filterItemsByWatermark(items, watermark)).toHaveLength(0);
  });
});

// --- fetchNewUploadsForChannel ---

describe("fetchNewUploadsForChannel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches the channel RSS and returns items after the watermark", async () => {
    const xmlContent = "<feed/>";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xmlContent),
    });

    const watermark = new Date("2024-05-01T00:00:00Z");
    const allItems = [
      makeFeedItem({
        guid: "new",
        publishedAt: new Date("2024-06-01T00:00:00Z"),
      }),
      makeFeedItem({
        guid: "old",
        publishedAt: new Date("2024-04-01T00:00:00Z"),
      }),
    ];
    mockParseRssFeedFromXml.mockResolvedValue(allItems);

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Test Channel",
      watermark,
    );

    expect(result).toHaveLength(1);
    expect(result[0].guid).toBe("new");
  });

  it("passes the channel title to parseRssFeedFromXml", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<feed/>"),
    });
    mockParseRssFeedFromXml.mockResolvedValue([]);

    await fetchNewUploadsForChannel("UCtest", 42, "My Channel", null);

    expect(mockParseRssFeedFromXml).toHaveBeenCalledWith(
      "<feed/>",
      42,
      "My Channel",
    );
  });

  it("returns all items when lastSyncedAt is null", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<feed/>"),
    });

    const items = [
      makeFeedItem({ publishedAt: new Date("2024-01-01T00:00:00Z") }),
      makeFeedItem({
        guid: "b",
        publishedAt: new Date("2023-01-01T00:00:00Z"),
      }),
    ];
    mockParseRssFeedFromXml.mockResolvedValue(items);

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
    );
    expect(result).toHaveLength(2);
  });

  it("propagates fetch errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    await expect(
      fetchNewUploadsForChannel("UCtest", 1, "Channel", null),
    ).rejects.toThrow("Channel RSS fetch failed for UCtest: 503");
  });
});
