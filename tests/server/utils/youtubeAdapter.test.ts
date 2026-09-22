import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  isTokenExpired,
  refreshAccessToken,
  fetchYouTubeSubscriptions,
  fetchSubscriptionChannelIds,
  uploadsPlaylistIdForChannel,
  mapPlaylistItemToFeedItem,
  fetchNewUploadsForChannel,
  TokenRefreshAuthError,
} from "../../../server/utils/youtubeAdapter";
import type {
  PlaylistItem,
  PlaylistItemContentDetails,
} from "../../../server/utils/youtubeAdapter";

function makePlaylistItem(
  overrides: Partial<PlaylistItem["snippet"]> = {},
  contentDetails?: PlaylistItemContentDetails,
): PlaylistItem {
  return {
    snippet: {
      title: "Test Video",
      description: "Video description",
      publishedAt: "2024-06-01T12:00:00Z",
      channelTitle: "Test Channel",
      resourceId: { videoId: "abc123" },
      thumbnails: {
        high: { url: "https://img.youtube.com/vi/abc123/hqdefault.jpg" },
      },
      ...overrides,
    },
    ...(contentDetails ? { contentDetails } : {}),
  };
}

function mockPlaylistPages(
  ...pages: { items: PlaylistItem[]; nextPageToken?: string }[]
): void {
  for (const page of pages) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(page),
    });
  }
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

// --- uploadsPlaylistIdForChannel ---

describe("uploadsPlaylistIdForChannel", () => {
  it("swaps the UC channel-id prefix for UU", () => {
    expect(uploadsPlaylistIdForChannel("UC12345")).toBe("UU12345");
  });

  it("throws for a channel id that doesn't start with UC", () => {
    expect(() => uploadsPlaylistIdForChannel("XX12345")).toThrow(
      'does not start with "UC"',
    );
  });
});

// --- mapPlaylistItemToFeedItem ---

describe("mapPlaylistItemToFeedItem", () => {
  it("maps a playlist item to a feed item", () => {
    const item = makePlaylistItem();

    const result = mapPlaylistItemToFeedItem(item, 5, "Fallback Channel");

    expect(result).toEqual({
      feedId: 5,
      guid: "yt:video:abc123",
      title: "Test Video",
      url: "https://www.youtube.com/watch?v=abc123",
      author: "Test Channel",
      content: "Video description",
      imageUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
      publishedAt: new Date("2024-06-01T12:00:00Z"),
      savedAt: null,
      readAt: null,
      starred: false,
      tags: null,
      searchVector: null,
    });
  });

  it("falls back to the passed-in channel title when snippet.channelTitle is missing", () => {
    const item = makePlaylistItem({ channelTitle: undefined });

    const result = mapPlaylistItemToFeedItem(item, 1, "Fallback Channel");
    expect(result.author).toBe("Fallback Channel");
  });

  it("falls back through thumbnail sizes when high isn't present", () => {
    const item = makePlaylistItem({
      thumbnails: { medium: { url: "https://img.example/medium.jpg" } },
    });

    const result = mapPlaylistItemToFeedItem(item, 1, "Channel");
    expect(result.imageUrl).toBe("https://img.example/medium.jpg");
  });

  it("sets imageUrl to null when there are no thumbnails", () => {
    const item = makePlaylistItem({ thumbnails: undefined });

    const result = mapPlaylistItemToFeedItem(item, 1, "Channel");
    expect(result.imageUrl).toBeNull();
  });

  it("sets publishedAt to null for a missing or invalid date", () => {
    const missing = mapPlaylistItemToFeedItem(
      makePlaylistItem({ publishedAt: undefined }),
      1,
      "Channel",
    );
    const invalid = mapPlaylistItemToFeedItem(
      makePlaylistItem({ publishedAt: "not-a-date" }),
      1,
      "Channel",
    );

    expect(missing.publishedAt).toBeNull();
    expect(invalid.publishedAt).toBeNull();
  });

  it("sets content to null for a missing description", () => {
    const result = mapPlaylistItemToFeedItem(
      makePlaylistItem({ description: undefined }),
      1,
      "Channel",
    );
    expect(result.content).toBeNull();
  });

  it("prefers contentDetails.videoPublishedAt over snippet.publishedAt (playlist-add time can predate the actual publish time for premieres)", () => {
    const item = makePlaylistItem(
      { publishedAt: "2024-05-01T00:00:00Z" },
      { videoPublishedAt: "2024-06-01T00:00:00Z" },
    );

    const result = mapPlaylistItemToFeedItem(item, 1, "Channel");
    expect(result.publishedAt).toEqual(new Date("2024-06-01T00:00:00Z"));
  });

  it("falls back to snippet.publishedAt when contentDetails.videoPublishedAt is absent", () => {
    const item = makePlaylistItem({ publishedAt: "2024-05-01T00:00:00Z" });

    const result = mapPlaylistItemToFeedItem(item, 1, "Channel");
    expect(result.publishedAt).toEqual(new Date("2024-05-01T00:00:00Z"));
  });
});

// --- fetchNewUploadsForChannel ---

describe("fetchNewUploadsForChannel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requests the derived uploads playlist with the access token as a bearer header", async () => {
    mockPlaylistPages({ items: [] });

    await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
      "my-access-token",
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("playlistId=UUtest"),
      expect.objectContaining({
        headers: { Authorization: "Bearer my-access-token" },
      }),
    );
  });

  it("returns all items when lastSyncedAt is null", async () => {
    mockPlaylistPages({
      items: [
        makePlaylistItem({ resourceId: { videoId: "v1" } }),
        makePlaylistItem({ resourceId: { videoId: "v2" } }),
      ],
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
      "token",
    );
    expect(result).toHaveLength(2);
  });

  it("stops at the first page when every item on it predates the watermark", async () => {
    const watermark = new Date("2024-05-01T00:00:00Z");
    mockPlaylistPages({
      items: [
        makePlaylistItem({
          resourceId: { videoId: "old" },
          publishedAt: "2024-04-01T00:00:00Z",
        }),
      ],
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );
    expect(result).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // A video added to the playlist just before the previous sync can go
  // public only afterward (premieres/scheduled uploads), or the API can lag
  // slightly behind real time — either way, an item right at the exact
  // watermark boundary might actually be new. Rather than exclude it
  // outright, pagination now stops PAGINATION_WATERMARK_OVERLAP_MS (24h)
  // *before* the watermark and lets feedItems' (feedId, guid) dedupe absorb
  // any already-synced items re-collected in that window.
  it("includes an item at exactly the watermark, relying on dedupe rather than excluding it outright", async () => {
    const watermark = new Date("2024-05-01T00:00:00Z");
    mockPlaylistPages({
      items: [
        makePlaylistItem({
          resourceId: { videoId: "new" },
          publishedAt: "2024-06-01T00:00:00Z",
        }),
        makePlaylistItem({
          resourceId: { videoId: "exact" },
          publishedAt: "2024-05-01T00:00:00Z",
        }),
      ],
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );
    const guids = result.map((item) => item.guid);
    expect(guids).toContain("yt:video:new");
    expect(guids).toContain("yt:video:exact");
  });

  it("stops pagination once an item's playlist-order date is past the widened (watermark minus 24h) stop point", async () => {
    const watermark = new Date("2024-05-01T00:00:00Z");
    mockPlaylistPages({
      items: [
        makePlaylistItem({
          resourceId: { videoId: "new" },
          publishedAt: "2024-06-01T00:00:00Z",
        }),
        makePlaylistItem({
          resourceId: { videoId: "within-overlap" },
          publishedAt: "2024-05-01T00:00:00Z",
        }),
        makePlaylistItem({
          resourceId: { videoId: "well-past-overlap" },
          publishedAt: "2024-01-01T00:00:00Z",
        }),
      ],
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );
    const guids = result.map((item) => item.guid);
    expect(guids).toContain("yt:video:new");
    expect(guids).toContain("yt:video:within-overlap");
    expect(guids).not.toContain("yt:video:well-past-overlap");
  });

  // Regression test for the silent-skip bug (#288): the channel RSS feed
  // (videos.xml) only ever returns the 15 most recent uploads, so any
  // upload past that fixed window between two syncs was lost forever no
  // matter how far back the watermark reached. Paginating the uploads
  // playlist instead must keep walking past a single page of 15 until the
  // watermark is actually reached.
  it("does not silently drop uploads when more than 15 videos land between syncs", async () => {
    const watermark = new Date("2024-01-01T00:00:00Z");

    // Two pages of 20 videos each (40 total), all newer than the watermark —
    // more than triple the old RSS feed's fixed 15-item window.
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      makePlaylistItem({
        resourceId: { videoId: `new-${index}` },
        publishedAt: "2024-06-01T00:00:00Z",
      }),
    );
    const secondPage = Array.from({ length: 20 }, (_, index) =>
      makePlaylistItem({
        resourceId: { videoId: `new-${20 + index}` },
        publishedAt: "2024-05-01T00:00:00Z",
      }),
    );

    mockPlaylistPages(
      { items: firstPage, nextPageToken: "page2" },
      { items: secondPage },
    );

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );

    expect(result).toHaveLength(40);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain("pageToken=page2");
  });

  it("excludes an undated item but keeps paginating past it instead of treating it as the watermark", async () => {
    const watermark = new Date("2024-01-01T00:00:00Z");

    mockPlaylistPages(
      {
        items: [
          makePlaylistItem({
            resourceId: { videoId: "undated" },
            publishedAt: undefined,
          }),
          makePlaylistItem({
            resourceId: { videoId: "newer" },
            publishedAt: "2024-06-01T00:00:00Z",
          }),
        ],
        nextPageToken: "page2",
      },
      {
        items: [
          makePlaylistItem({
            resourceId: { videoId: "page2-item" },
            publishedAt: "2024-05-01T00:00:00Z",
          }),
        ],
      },
    );

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );

    const guids = result.map((item) => item.guid);
    expect(guids).not.toContain("yt:video:undated");
    expect(guids).toContain("yt:video:newer");
    expect(guids).toContain("yt:video:page2-item");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("skips a malformed item with no resourceId.videoId instead of failing the whole sync", async () => {
    mockPlaylistPages({
      items: [
        { snippet: {} } as unknown as PlaylistItem,
        makePlaylistItem({ resourceId: { videoId: "ok" } }),
      ],
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
      "token",
    );

    expect(result).toHaveLength(1);
    expect(result[0].guid).toBe("yt:video:ok");
  });

  it("logs a warning when it stops at MAX_PAGES without reaching the watermark", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // A watermark far enough in the past that MAX_PAGES worth of items,
      // published newest-first down to 2024-06-01, never reaches it — keeps
      // the loop under the returning-sync page cap (MAX_PAGES) rather than
      // the first-sync one (a null watermark would only ever fetch one
      // page).
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                makePlaylistItem({
                  resourceId: { videoId: "v" },
                  publishedAt: "2024-06-01T00:00:00Z",
                }),
              ],
              nextPageToken: "always-more",
            }),
        }),
      );

      await fetchNewUploadsForChannel(
        "UCtest",
        1,
        "Channel",
        new Date("2020-01-01T00:00:00Z"),
        "token",
      );

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("stopped after 20 pages for channel UCtest"),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not log the MAX_PAGES warning when the watermark is reached on the final page", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const watermark = new Date("2024-05-01T00:00:00Z");

    try {
      // 20 pages (the MAX_PAGES cap) where every page's item is newer than
      // the watermark except the very last one, which reaches it — and the
      // API still reports a nextPageToken on that last page (there's more
      // history behind it). Hitting the cap, reaching the watermark, and
      // still having a next page all on the same page must not be logged as
      // a truncation: the sync got everything it needed, it just also
      // happened to be the last page it was willing to fetch.
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount += 1;
        const isFinalPage = callCount === 20;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                makePlaylistItem({
                  resourceId: { videoId: `v${callCount}` },
                  publishedAt: isFinalPage
                    ? "2024-04-01T00:00:00Z"
                    : "2024-06-01T00:00:00Z",
                }),
              ],
              nextPageToken: "more",
            }),
        });
      });

      await fetchNewUploadsForChannel(
        "UCtest",
        1,
        "Channel",
        watermark,
        "token",
      );

      expect(errorSpy).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(20);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stops after MAX_PAGES instead of paginating forever", async () => {
    // A never-ending nextPageToken with a watermark that's never reached
    // (an old watermark and an unbounded upload history) must not turn this
    // into an unbounded loop inside the sync function.
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              makePlaylistItem({
                resourceId: { videoId: "v" },
                publishedAt: "2024-06-01T00:00:00Z",
              }),
            ],
            nextPageToken: "always-more",
          }),
      }),
    );

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      new Date("2020-01-01T00:00:00Z"),
      "token",
    );

    expect(result).toHaveLength(20);
    expect(mockFetch).toHaveBeenCalledTimes(20);
  });

  it("fetches only one page on first sync (no watermark), even when more pages are available", async () => {
    // First sync previously got only the RSS feed's 15 most recent uploads;
    // capping it at one page here keeps that same "recent activity, not
    // full history" behavior instead of walking the full MAX_PAGES cap (and
    // its quota cost) for a brand-new subscription.
    mockPlaylistPages({
      items: [makePlaylistItem({ resourceId: { videoId: "v1" } })],
      nextPageToken: "page2",
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
      "token",
    );

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("stops mid-page-2 once the watermark is reached, without fetching a third page", async () => {
    const watermark = new Date("2024-05-15T00:00:00Z");

    mockPlaylistPages(
      {
        items: [
          makePlaylistItem({
            resourceId: { videoId: "p1-a" },
            publishedAt: "2024-06-01T00:00:00Z",
          }),
        ],
        nextPageToken: "page2",
      },
      {
        items: [
          makePlaylistItem({
            resourceId: { videoId: "p2-a" },
            publishedAt: "2024-05-20T00:00:00Z",
          }),
          makePlaylistItem({
            resourceId: { videoId: "p2-old" },
            publishedAt: "2024-05-01T00:00:00Z",
          }),
        ],
        nextPageToken: "page3",
      },
    );

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );

    const guids = result.map((item) => item.guid);
    expect(guids).toEqual(["yt:video:p1-a", "yt:video:p2-a"]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops the pagination watermark check on the playlist's add-time ordering, not the more accurate displayed publish date", async () => {
    // A video that was privately uploaded long ago and made public just now
    // sits at the top of the playlist (snippet.publishedAt is recent — that
    // is the order the API actually returns items in) even though its
    // contentDetails.videoPublishedAt is old. Stopping pagination on the
    // *displayed* date here would silently drop every real new upload below
    // it, which is the exact bug class this function fixes.
    const watermark = new Date("2024-01-01T00:00:00Z");

    mockPlaylistPages(
      {
        items: [
          makePlaylistItem(
            {
              resourceId: { videoId: "recently-made-public" },
              publishedAt: "2024-06-01T00:00:00Z",
            },
            { videoPublishedAt: "2020-01-01T00:00:00Z" },
          ),
        ],
        nextPageToken: "page2",
      },
      {
        items: [
          makePlaylistItem({
            resourceId: { videoId: "page2-item" },
            publishedAt: "2024-05-01T00:00:00Z",
          }),
        ],
      },
    );

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      watermark,
      "token",
    );

    const guids = result.map((item) => item.guid);
    expect(guids).toContain("yt:video:recently-made-public");
    expect(guids).toContain("yt:video:page2-item");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns an empty result and makes no further calls when a page response has no items key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
      "token",
    );

    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates fetch errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    await expect(
      fetchNewUploadsForChannel("UCtest", 1, "Channel", null, "token"),
    ).rejects.toThrow("Channel uploads fetch failed for playlist UUtest: 503");
  });

  it("treats a 404 (channel has no uploads playlist) as an empty page instead of throwing", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Channel",
      null,
      "token",
    );

    expect(result).toEqual([]);
  });

  it("throws when the channel id can't be turned into an uploads playlist id", async () => {
    await expect(
      fetchNewUploadsForChannel(
        "not-a-channel-id",
        1,
        "Channel",
        null,
        "token",
      ),
    ).rejects.toThrow('does not start with "UC"');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
