import { describe, it, expect } from "vitest";

// This suite deliberately does NOT mock rss-parser: it exercises the real parser
// so it proves the `category` customField mapping actually populates tags for
// Atom entries. The built-in parser only fills `categories` for RSS, so without
// the mapping every Atom/YouTube feed would silently store `tags: null`.
import { parseRssFeedFromXml } from "../../../server/utils/rssAdapter";

const FEED_ID = 99;

// Real-shaped Atom entry carrying two <category term="..."/> elements plus a
// duplicate-by-case to prove normalization runs end to end.
const ATOM_WITH_CATEGORIES = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <id>urn:atom:1</id>
    <title>Atom Entry</title>
    <link rel="alternate" href="https://example.com/atom/1"/>
    <published>2024-06-01T12:00:00+00:00</published>
    <category term="Tech"/>
    <category term="tech"/>
    <category term="Web Dev"/>
  </entry>
</feed>`;

const ATOM_WITHOUT_CATEGORIES = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <id>urn:atom:2</id>
    <title>No Categories</title>
    <link rel="alternate" href="https://example.com/atom/2"/>
    <published>2024-06-01T12:00:00+00:00</published>
  </entry>
</feed>`;

// RSS 2.0 item with multiple <category> elements: the built-in parser fills
// `categories` here (unlike Atom), so this guards the RSS path end to end.
const RSS_WITH_CATEGORIES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RSS Feed</title>
    <item>
      <title>RSS Item</title>
      <link>https://example.com/rss/1</link>
      <guid>urn:rss:1</guid>
      <pubDate>Sat, 01 Jun 2024 12:00:00 GMT</pubDate>
      <category>Tech</category>
      <category>tech</category>
      <category domain="http://example.com/cats">Web Dev</category>
    </item>
  </channel>
</rss>`;

describe("parseRssFeedFromXml — Atom category tags (real parser)", () => {
  it("populates tags from <category term> on Atom entries", async () => {
    const [item] = await parseRssFeedFromXml(ATOM_WITH_CATEGORIES, FEED_ID);
    // Fails if the `category` customField mapping is removed (tags → null),
    // since the built-in parser never fills categories for Atom.
    expect(item.tags).toEqual(["tech", "web dev"]);
  });

  it("leaves tags null when an Atom entry has no categories", async () => {
    const [item] = await parseRssFeedFromXml(ATOM_WITHOUT_CATEGORIES, FEED_ID);
    expect(item.tags).toBeNull();
  });

  it("populates tags from <category> on RSS items (domain attr and text)", async () => {
    const [item] = await parseRssFeedFromXml(RSS_WITH_CATEGORIES, FEED_ID);
    expect(item.tags).toEqual(["tech", "web dev"]);
  });
});
