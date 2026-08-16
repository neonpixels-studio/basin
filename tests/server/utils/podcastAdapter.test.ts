import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dnsModule from "dns";

const { mockParseString, mockParseURL } = vi.hoisted(() => ({
  mockParseString: vi.fn(),
  mockParseURL: vi.fn(),
}));

vi.mock("rss-parser", () => {
  class MockParser {
    parseString = mockParseString;
    parseURL = mockParseURL;
  }
  return { default: MockParser };
});

import {
  normalizeDurationToSeconds,
  parsePodcastFeedFromXml,
  parsePodcastFeed,
} from "../../../server/utils/podcastAdapter";

// assertSafeFeedUrl (imported from rssAdapter) now delegates to the
// DNS-resolving urlValidator, so a URL-based parse needs a mocked DNS
// resolution to a public address to reach parser.parseURL.
const mockResolve4 = vi.spyOn(dnsModule.promises, "resolve4");
const mockResolve6 = vi.spyOn(dnsModule.promises, "resolve6");

const FEED_ID = 7;

function makePodcastItem(overrides: Record<string, unknown> = {}) {
  return {
    title: "Episode 1",
    link: "https://example.com/ep/1",
    guid: "urn:podcast:1",
    isoDate: "2024-03-01T12:00:00.000Z",
    enclosure: {
      url: "https://cdn.example.com/ep1.mp3",
      type: "audio/mpeg",
      length: 12345678,
    },
    "itunes:duration": "45:30",
    "itunes:image": { $: { href: "https://example.com/ep1-art.jpg" } },
    "itunes:episode": "42",
    "itunes:season": "2",
    "itunes:explicit": "no",
    "itunes:summary": "Episode summary text.",
    ...overrides,
  };
}

function makeFeedOutput(
  items: unknown[] = [makePodcastItem()],
  feedOverrides: Record<string, unknown> = {},
) {
  return {
    title: "My Podcast",
    "itunes:image": { $: { href: "https://example.com/channel-art.jpg" } },
    items,
    ...feedOverrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeDurationToSeconds
// ---------------------------------------------------------------------------
describe("normalizeDurationToSeconds", () => {
  it("handles HH:MM:SS format", () => {
    expect(normalizeDurationToSeconds("1:30:00")).toBe(5400);
  });

  it("handles MM:SS format", () => {
    expect(normalizeDurationToSeconds("45:30")).toBe(2730);
  });

  it("handles raw seconds as a string", () => {
    expect(normalizeDurationToSeconds("3600")).toBe(3600);
  });

  it("handles zero seconds", () => {
    expect(normalizeDurationToSeconds("0")).toBe(0);
  });

  it("handles MM:SS with zero seconds", () => {
    expect(normalizeDurationToSeconds("30:00")).toBe(1800);
  });

  it("handles HH:MM:SS with leading zeros", () => {
    expect(normalizeDurationToSeconds("02:05:03")).toBe(7503);
  });

  it("returns null for undefined input", () => {
    expect(normalizeDurationToSeconds(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeDurationToSeconds("")).toBeNull();
  });

  it("returns null for non-numeric garbage", () => {
    expect(normalizeDurationToSeconds("not-a-duration")).toBeNull();
  });

  it("returns null for a partial colon-format with non-numeric segments", () => {
    expect(normalizeDurationToSeconds("1:xx:30")).toBeNull();
  });

  it("returns null for negative duration components", () => {
    expect(normalizeDurationToSeconds("1:-30")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePodcastFeedFromXml — field mapping
// ---------------------------------------------------------------------------
describe("parsePodcastFeedFromXml", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps guid from item.guid", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ guid: "urn:custom:guid" })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.guid).toBe("urn:custom:guid");
  });

  it("leaves new episodes unsaved and unread by default", async () => {
    mockParseString.mockResolvedValue(makeFeedOutput([makePodcastItem()]));

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.savedAt).toBeNull();
    expect(item.readAt).toBeNull();
    expect(item.starred).toBe(false);
  });

  it("falls back to hash of enclosure URL when guid is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({
          guid: undefined,
          enclosure: {
            url: "https://cdn.example.com/ep1.mp3",
            type: "audio/mpeg",
          },
        }),
      ]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(typeof item.guid).toBe("string");
    expect(item.guid.length).toBeGreaterThan(0);
  });

  it("produces the same hash for the same enclosure URL across two items", async () => {
    const enclosureUrl = "https://cdn.example.com/ep-same.mp3";
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({
          guid: undefined,
          enclosure: { url: enclosureUrl, type: "audio/mpeg" },
        }),
        makePodcastItem({
          guid: undefined,
          enclosure: { url: enclosureUrl, type: "audio/mpeg" },
        }),
      ]),
    );

    const [first, second] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(first.guid).toBe(second.guid);
  });

  it("maps mediaUrl from enclosure url", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({
          enclosure: {
            url: "https://cdn.example.com/ep1.mp3",
            type: "audio/mpeg",
          },
        }),
      ]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.mediaUrl).toBe("https://cdn.example.com/ep1.mp3");
  });

  it("sets mediaUrl to null when no enclosure is present", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ enclosure: undefined })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.mediaUrl).toBeNull();
  });

  it("normalizes itunes:duration MM:SS to seconds", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ "itunes:duration": "45:30" })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.mediaDuration).toBe(2730);
  });

  it("normalizes itunes:duration HH:MM:SS to seconds", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ "itunes:duration": "1:30:00" })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.mediaDuration).toBe(5400);
  });

  it("normalizes itunes:duration raw seconds to integer", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ "itunes:duration": "7200" })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.mediaDuration).toBe(7200);
  });

  it("sets mediaDuration to null when itunes:duration is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ "itunes:duration": undefined })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.mediaDuration).toBeNull();
  });

  it("uses episode-level itunes:image when present", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({
          "itunes:image": { $: { href: "https://example.com/ep-art.jpg" } },
        }),
      ]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.imageUrl).toBe("https://example.com/ep-art.jpg");
  });

  it("falls back to channel-level itunes:image when episode image is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ "itunes:image": undefined })], {
        "itunes:image": { $: { href: "https://example.com/channel-art.jpg" } },
      }),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.imageUrl).toBe("https://example.com/channel-art.jpg");
  });

  it("sets imageUrl to null when neither episode nor channel image is present", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ "itunes:image": undefined })], {
        "itunes:image": undefined,
      }),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.imageUrl).toBeNull();
  });

  it("uses itunes:summary as content when present", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({
          "itunes:summary": "iTunes summary text",
          contentSnippet: "Snippet text",
          content: "Full HTML",
        }),
      ]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("iTunes summary text");
  });

  it("falls back to contentSnippet when itunes:summary is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({
          "itunes:summary": undefined,
          contentSnippet: "Snippet text",
          content: "Full HTML",
        }),
      ]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("Snippet text");
  });

  it("uses feed title as author", async () => {
    mockParseString.mockResolvedValue(makeFeedOutput([makePodcastItem()]));

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.author).toBe("My Podcast");
  });

  it("uses feedTitle override as author when provided", async () => {
    mockParseString.mockResolvedValue(makeFeedOutput([makePodcastItem()]));

    const [item] = await parsePodcastFeedFromXml(
      "<rss/>",
      FEED_ID,
      "Override Title",
    );
    expect(item.author).toBe("Override Title");
  });

  it("sets feedId on all items", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({ guid: "urn:p:1" }),
        makePodcastItem({ guid: "urn:p:2" }),
      ]),
    );

    const items = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(items.every((item) => item.feedId === FEED_ID)).toBe(true);
  });

  it("caps items at MAX_ITEMS_PER_SYNC (50)", async () => {
    const manyItems = Array.from({ length: 80 }, (_, index) =>
      makePodcastItem({ guid: `urn:p:${index}` }),
    );
    mockParseString.mockResolvedValue(makeFeedOutput(manyItems));

    const items = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(items.length).toBe(50);
  });

  it("returns an empty array when the feed has no items", async () => {
    mockParseString.mockResolvedValue(makeFeedOutput([]));

    const items = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parsePodcastFeed — URL-based fetch (validates URL, delegates to parseURL)
// ---------------------------------------------------------------------------
describe("parsePodcastFeed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: resolve any hostname to a public IPv4 address so the URL
    // reaches parser.parseURL. Tests below override with literal IPs/hostnames
    // that are blocked before DNS resolution is even attempted.
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("ENODATA"));
  });

  it("fetches by URL and returns mapped items", async () => {
    mockParseURL.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ guid: "urn:url:1" })]),
    );

    const items = await parsePodcastFeed(
      "https://example.com/podcast.xml",
      FEED_ID,
    );
    expect(items).toHaveLength(1);
    expect(items[0].guid).toBe("urn:url:1");
    expect(mockParseURL).toHaveBeenCalledWith(
      "https://example.com/podcast.xml",
    );
  });

  it("rejects non-http/https protocols", async () => {
    await expect(
      parsePodcastFeed("ftp://example.com/podcast.xml", FEED_ID),
    ).rejects.toThrow("http or https");
  });

  it("rejects localhost", async () => {
    await expect(
      parsePodcastFeed("http://localhost/podcast.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects private IP ranges", async () => {
    await expect(
      parsePodcastFeed("http://192.168.1.1/podcast.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects a hostname that resolves to a private IP (e.g. DNS rebinding on sync)", async () => {
    // Mirrors the equivalent rssAdapter test: a domain that is not a blocked
    // literal but DNS-resolves to an internal address must still be caught,
    // and since parsePodcastFeed re-validates on every sync (not just at add
    // time), a feed that rebinds after being added is rejected on its next
    // scheduled sync.
    mockResolve4.mockResolvedValueOnce(["172.16.0.9"]);
    mockResolve6.mockRejectedValueOnce(new Error("ENODATA"));

    await expect(
      parsePodcastFeed("http://rebound.example.com/podcast.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
    expect(mockParseURL).not.toHaveBeenCalled();
  });
});

describe("parsePodcastFeedFromXml tags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps episode categories to normalized tags", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makePodcastItem({ categories: ["Comedy", "comedy", "  Society  "] }),
      ]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.tags).toEqual(["Comedy", "Society"]);
  });

  it("leaves tags null when the episode has no categories", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makePodcastItem({ categories: undefined })]),
    );

    const [item] = await parsePodcastFeedFromXml("<rss/>", FEED_ID);
    expect(item.tags).toBeNull();
  });
});
