import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// This suite deliberately does NOT mock rssAdapter: it exercises the real
// parser so it proves the media:group > media:description customField mapping
// actually populates content. fetch is stubbed so no network is touched.
const mockFetch = vi.fn();

import { fetchNewUploadsForChannel } from "../../../server/utils/youtubeAdapter";

// Includes &, <, > — common in real descriptions — to prove the parser
// decodes XML entities back to their characters rather than the fixture
// smuggling raw text through.
const VIDEO_DESCRIPTION = "R&D update: a < b > c.\nSecond line.";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Real-shaped YouTube channel Atom feed: the video body lives only in
// media:group > media:description (no <content>/<summary> at entry level).
const YOUTUBE_ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Test Channel</title>
  <entry>
    <id>yt:video:abc123</id>
    <yt:videoId>abc123</yt:videoId>
    <yt:channelId>UCtest</yt:channelId>
    <title>My Video Title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <author><name>Test Channel</name><uri>https://www.youtube.com/channel/UCtest</uri></author>
    <published>2024-06-01T12:00:00+00:00</published>
    <updated>2024-06-02T12:00:00+00:00</updated>
    <media:group>
      <media:title>My Video Title</media:title>
      <media:content url="https://www.youtube.com/v/abc123" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg" width="480" height="360"/>
      <media:description>${escapeXml(VIDEO_DESCRIPTION)}</media:description>
    </media:group>
  </entry>
</feed>`;

describe("fetchNewUploadsForChannel — YouTube description mapping", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(YOUTUBE_ATOM_FIXTURE),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("populates content from media:group > media:description", async () => {
    const items = await fetchNewUploadsForChannel(
      "UCtest",
      1,
      "Test Channel",
      null,
    );

    expect(items).toHaveLength(1);
    // Fails if the media:group customField mapping is removed (content → null).
    expect(items[0].content).toBe(VIDEO_DESCRIPTION);
  });

  it("still maps the other item fields alongside the description", async () => {
    const [item] = await fetchNewUploadsForChannel(
      "UCtest",
      7,
      "Test Channel",
      null,
    );

    expect(item.feedId).toBe(7);
    expect(item.title).toBe("My Video Title");
    expect(item.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(item.publishedAt).toEqual(new Date("2024-06-01T12:00:00+00:00"));
  });
});
