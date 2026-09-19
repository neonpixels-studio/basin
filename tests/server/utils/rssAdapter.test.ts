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
  parseRssFeedFromXml,
  parseRssFeed,
} from "../../../server/utils/rssAdapter";

// assertSafeFeedUrl now delegates to the DNS-resolving urlValidator (see
// server/utils/urlValidator.ts), so a URL-based parse needs a mocked DNS
// resolution to a public address to reach parser.parseURL.
const mockResolve4 = vi.spyOn(dnsModule.promises, "resolve4");
const mockResolve6 = vi.spyOn(dnsModule.promises, "resolve6");

const FEED_ID = 42;

function makeRssItem(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Item",
    link: "https://example.com/post/1",
    guid: "urn:example:1",
    creator: "Alice",
    contentSnippet: "Short snippet of the article.",
    isoDate: "2024-01-15T10:00:00.000Z",
    ...overrides,
  };
}

function makeFeedOutput(items: unknown[] = [makeRssItem()]) {
  return {
    title: "Test Feed",
    image: { url: "https://example.com/logo.png" },
    items,
  };
}

describe("parseRssFeedFromXml", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps guid from item.guid", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ guid: "urn:example:unique" })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.guid).toBe("urn:example:unique");
  });

  it("falls back to hash of link when guid is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({ guid: undefined, link: "https://example.com/post/2" }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(typeof item.guid).toBe("string");
    expect(item.guid.length).toBeGreaterThan(0);
  });

  it("maps title", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ title: "Hello World" })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.title).toBe("Hello World");
  });

  it("falls back to (untitled) when title is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ title: undefined })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.title).toBe("(untitled)");
  });

  it("maps url from item.link", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ link: "https://example.com/page" })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.url).toBe("https://example.com/page");
  });

  it("maps author from item.creator", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ creator: "Bob Smith" })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.author).toBe("Bob Smith");
  });

  it("falls back to feed title when creator is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ creator: undefined })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID, "My Blog");
    expect(item.author).toBe("My Blog");
  });

  it("maps content from contentSnippet", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({ contentSnippet: "Snippet text", content: "Full HTML" }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("Snippet text");
  });

  it("falls back to content when contentSnippet is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({ contentSnippet: undefined, content: "Full HTML" }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("Full HTML");
  });

  it("falls back to media:group description when no content is present", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          contentSnippet: undefined,
          content: undefined,
          mediaGroup: { "media:description": ["The video description."] },
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("The video description.");
  });

  it("prefers item content over the media:group description", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          contentSnippet: undefined,
          content: "Real article body",
          mediaGroup: { "media:description": ["Should not win"] },
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("Real article body");
  });

  it("unwraps the text when the media:group description carries attributes", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          contentSnippet: undefined,
          content: undefined,
          // Attributed elements parse to { _: text, $: attrs }.
          mediaGroup: {
            "media:description": [
              { _: "Attributed text", $: { type: "plain" } },
            ],
          },
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBe("Attributed text");
  });

  it("sets content to null for a whitespace-only media:group description", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          contentSnippet: undefined,
          content: undefined,
          mediaGroup: { "media:description": ["   \n  "] },
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBeNull();
  });

  it("sets content to null when the media:group description node has no text", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          contentSnippet: undefined,
          content: undefined,
          mediaGroup: { "media:description": [{}] },
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBeNull();
  });

  it("keeps content null for a plain feed with no content or media:group", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({ contentSnippet: undefined, content: undefined }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.content).toBeNull();
  });

  it("maps publishedAt from isoDate", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          isoDate: "2024-03-10T08:30:00.000Z",
          pubDate: undefined,
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.publishedAt).toEqual(new Date("2024-03-10T08:30:00.000Z"));
  });

  it("falls back to pubDate when isoDate is absent", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          isoDate: undefined,
          pubDate: "Mon, 10 Mar 2024 08:30:00 GMT",
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.publishedAt).toBeInstanceOf(Date);
  });

  it("sets publishedAt to null when no date is present", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ isoDate: undefined, pubDate: undefined })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.publishedAt).toBeNull();
  });

  it("sets imageUrl from image enclosure when type is image/*", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({
          enclosure: { url: "https://example.com/img.jpg", type: "image/jpeg" },
        }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.imageUrl).toBe("https://example.com/img.jpg");
  });

  it("falls back to feed image when item has no image enclosure", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ enclosure: undefined })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.imageUrl).toBe("https://example.com/logo.png");
  });

  it("sets feedId on all items", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem(), makeRssItem({ guid: "urn:example:2" })]),
    );

    const items = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(items.every((item) => item.feedId === FEED_ID)).toBe(true);
  });

  it("leaves new items unsaved and unread by default", async () => {
    mockParseString.mockResolvedValue(makeFeedOutput([makeRssItem()]));

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.savedAt).toBeNull();
    expect(item.readAt).toBeNull();
    expect(item.starred).toBe(false);
  });

  it("caps items at MAX_ITEMS_PER_SYNC (50)", async () => {
    const manyItems = Array.from({ length: 80 }, (_, index) =>
      makeRssItem({ guid: `urn:example:${index}` }),
    );
    mockParseString.mockResolvedValue(makeFeedOutput(manyItems));

    const items = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(items.length).toBe(50);
  });

  it("returns an empty array when the feed has no items", async () => {
    mockParseString.mockResolvedValue(makeFeedOutput([]));

    const items = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(items).toHaveLength(0);
  });

  it("propagates parse errors", async () => {
    mockParseString.mockRejectedValue(new Error("Invalid XML"));

    await expect(parseRssFeedFromXml("<bad/>", FEED_ID)).rejects.toThrow(
      "Invalid XML",
    );
  });
});

describe("parseRssFeed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: resolve any hostname to a public IPv4 address so the URL
    // reaches parser.parseURL. Tests below override with literal IPs/hostnames
    // that are blocked before DNS resolution is even attempted.
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("ENODATA"));
  });

  it("uses parseURL and returns mapped items", async () => {
    mockParseURL.mockResolvedValue(
      makeFeedOutput([makeRssItem({ guid: "urn:url:1" })]),
    );

    const items = await parseRssFeed("https://example.com/feed.xml", FEED_ID);
    expect(items).toHaveLength(1);
    expect(items[0].guid).toBe("urn:url:1");
    expect(mockParseURL).toHaveBeenCalledWith("https://example.com/feed.xml");
  });

  it("caps items at MAX_ITEMS_PER_SYNC when fetching by URL", async () => {
    const manyItems = Array.from({ length: 75 }, (_, index) =>
      makeRssItem({ guid: `urn:url:${index}` }),
    );
    mockParseURL.mockResolvedValue(makeFeedOutput(manyItems));

    const items = await parseRssFeed("https://example.com/feed.xml", FEED_ID);
    expect(items.length).toBe(50);
  });

  it("rejects non-http/https protocols", async () => {
    await expect(
      parseRssFeed("ftp://example.com/feed.xml", FEED_ID),
    ).rejects.toThrow("http or https");
  });

  it("rejects localhost", async () => {
    await expect(
      parseRssFeed("http://localhost/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects 127.0.0.1", async () => {
    await expect(
      parseRssFeed("http://127.0.0.1/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects private 10.x.x.x range", async () => {
    await expect(
      parseRssFeed("http://10.0.0.1/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects private 192.168.x.x range", async () => {
    await expect(
      parseRssFeed("http://192.168.1.1/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects private 172.16.x.x range", async () => {
    await expect(
      parseRssFeed("http://172.16.0.1/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects link-local 169.254.x.x range (cloud metadata)", async () => {
    await expect(
      parseRssFeed("http://169.254.169.254/latest/meta-data/", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects 0.0.0.0", async () => {
    await expect(
      parseRssFeed("http://0.0.0.0/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects IPv6 loopback ::1", async () => {
    await expect(
      parseRssFeed("http://[::1]/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects IPv4-mapped IPv6 ::ffff:127.0.0.1", async () => {
    await expect(
      parseRssFeed("http://[::ffff:127.0.0.1]/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects IPv4-mapped IPv6 hex form ::ffff:7f00:1", async () => {
    await expect(
      parseRssFeed("http://[::ffff:7f00:1]/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
  });

  it("rejects a hostname that resolves to a private IP (e.g. DNS rebinding on sync)", async () => {
    // This is the case a literal-hostname regex check can never catch: the
    // domain itself is not a blocked literal, but DNS resolves it to an
    // internal address. Since parseRssFeed re-validates on every sync (not
    // just when the feed was added), a feed that rebinds after add time is
    // still rejected on its next scheduled sync rather than being fetched
    // indefinitely.
    mockResolve4.mockResolvedValueOnce(["10.0.0.5"]);
    mockResolve6.mockRejectedValueOnce(new Error("ENODATA"));

    await expect(
      parseRssFeed("http://rebound.example.com/feed.xml", FEED_ID),
    ).rejects.toThrow("disallowed address");
    expect(mockParseURL).not.toHaveBeenCalled();
  });

  it("rejects invalid URLs", async () => {
    await expect(parseRssFeed("not-a-url", FEED_ID)).rejects.toThrow(
      "Invalid URL",
    );
  });
});

describe("resolveGuid fallback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses a deterministic hash when guid and link are both absent", async () => {
    const item = makeRssItem({
      guid: undefined,
      link: undefined,
      title: "Stable Title",
      isoDate: "2024-01-01T00:00:00Z",
      pubDate: undefined,
      contentSnippet: "snippet",
      content: "full content",
    });

    mockParseString.mockResolvedValue(makeFeedOutput([item, item]));

    const [first, second] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(first.guid).toBe(second.guid);
    expect(first.guid).not.toBe("");
  });

  it("returns a deterministic hash when all stable fields are absent", async () => {
    const item = makeRssItem({
      guid: undefined,
      link: undefined,
      title: undefined,
      isoDate: undefined,
      pubDate: undefined,
      contentSnippet: undefined,
      content: undefined,
    });

    mockParseString.mockResolvedValue(makeFeedOutput([item, item]));

    const [first, second] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(first.guid).toBe(second.guid);
    expect(typeof first.guid).toBe("string");
    expect(first.guid.length).toBeGreaterThan(0);
  });
});

describe("parseRssFeedFromXml tags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps item.categories to normalized tags", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([
        makeRssItem({ categories: ["Tech", "  News  ", "tech"] }),
      ]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.tags).toEqual(["tech", "news"]);
  });

  it("leaves tags null when the item has no categories", async () => {
    mockParseString.mockResolvedValue(
      makeFeedOutput([makeRssItem({ categories: undefined })]),
    );

    const [item] = await parseRssFeedFromXml("<rss/>", FEED_ID);
    expect(item.tags).toBeNull();
  });
});
