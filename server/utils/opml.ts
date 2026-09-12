// Parses and serializes OPML (Outline Processor Markup Language) documents —
// the standard export/import format for feed subscription lists.
//
// OPML feed entries are <outline> elements with an `xmlUrl` attribute; they
// may be nested inside category/folder outlines with no `xmlUrl` of their
// own. This module deliberately does not build a full XML DOM: OPML feed
// outlines are always self-contained opening tags (attributes only, no text
// content we care about), so a tag-scoped regex is sufficient and avoids
// pulling in a general-purpose XML parser for a narrow, well-defined shape.

import { escapeXmlEntities } from "./xml";

export interface OpmlFeedEntry {
  xmlUrl: string;
  title: string | null;
  htmlUrl: string | null;
}

export interface OpmlExportFeed {
  url: string;
  title: string | null;
}

export interface OpmlParseResult {
  entries: OpmlFeedEntry[];
  // Count of feed outlines dropped solely because the document exceeded
  // MAX_OPML_ENTRIES, so callers can tell the user their file was truncated
  // rather than fully processed.
  truncatedCount: number;
}

// Guards against a pathological OPML file turning an import into hundreds
// of outbound feed-validation requests in a single request lifetime.
export const MAX_OPML_ENTRIES = 50;

export class OpmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpmlParseError";
  }
}

const OPML_ROOT_PATTERN = /<opml\b/i;
// Matches only well-formed name="value" (or name='value') attribute pairs
// rather than stopping at the first raw `>`, so a quoted value containing an
// unescaped `>` (e.g. title="a > b") doesn't truncate the tag early and drop
// the feed. serializeOpml always escapes `>`, so this only matters for
// third-party OPML files.
const OUTLINE_TAG_PATTERN =
  /<outline\b((?:\s+[a-zA-Z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

function unescapeXmlEntities(value: string): string {
  let unescaped = value;
  for (const [entity, character] of Object.entries(NAMED_ENTITIES)) {
    unescaped = unescaped.split(entity).join(character);
  }
  // Decode &amp; last so "&amp;lt;" round-trips to the literal text "&lt;"
  // rather than being mistaken for a doubly-escaped "<".
  return unescaped.split("&amp;").join("&");
}

function extractAttribute(
  tagAttributes: string,
  attributeName: string,
): string | null {
  // Requires whitespace (or start-of-string) immediately before the name so
  // e.g. extracting "text" doesn't also match a "subtext" attribute.
  const pattern = new RegExp(
    `(?:^|\\s)${attributeName}\\s*=\\s*"([^"]*)"|(?:^|\\s)${attributeName}\\s*=\\s*'([^']*)'`,
    "i",
  );
  const match = pattern.exec(tagAttributes);
  const raw = match?.[1] ?? match?.[2];
  return raw ? unescapeXmlEntities(raw) : null;
}

function parseOutlineTag(tagAttributes: string): OpmlFeedEntry | null {
  const xmlUrl = extractAttribute(tagAttributes, "xmlUrl");
  if (!xmlUrl) {
    return null;
  }

  const title =
    extractAttribute(tagAttributes, "title") ??
    extractAttribute(tagAttributes, "text");

  return {
    xmlUrl,
    title,
    htmlUrl: extractAttribute(tagAttributes, "htmlUrl"),
  };
}

function dedupeByUrl(entries: OpmlFeedEntry[]): OpmlFeedEntry[] {
  const seen = new Set<string>();
  const deduped: OpmlFeedEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.xmlUrl)) {
      continue;
    }
    seen.add(entry.xmlUrl);
    deduped.push(entry);
  }

  return deduped;
}

/**
 * Parses an OPML document into the list of feed outlines it declares.
 * Outlines without an `xmlUrl` (e.g. folder/category outlines) are treated
 * as containers and skipped rather than treated as errors — only the leaf
 * feed outlines are returned. Malformed individual outline tags are simply
 * skipped rather than aborting the whole parse; only a document missing the
 * `<opml>` root entirely is treated as invalid. `truncatedCount` reports how
 * many deduped entries were cut solely by the MAX_OPML_ENTRIES cap.
 */
export function parseOpml(xml: string): OpmlParseResult {
  if (!xml?.trim() || !OPML_ROOT_PATTERN.test(xml)) {
    throw new OpmlParseError("File is not a valid OPML document");
  }

  const entries: OpmlFeedEntry[] = [];
  let match: RegExpExecArray | null;

  OUTLINE_TAG_PATTERN.lastIndex = 0;
  while ((match = OUTLINE_TAG_PATTERN.exec(xml)) !== null) {
    const entry = parseOutlineTag(match[1]);
    if (entry) {
      entries.push(entry);
    }
  }

  const deduped = dedupeByUrl(entries);
  const capped = deduped.slice(0, MAX_OPML_ENTRIES);

  return { entries: capped, truncatedCount: deduped.length - capped.length };
}

function serializeOutline(feed: OpmlExportFeed): string {
  const title = escapeXmlEntities(feed.title ?? feed.url);
  const xmlUrl = escapeXmlEntities(feed.url);
  return `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}"/>`;
}

/**
 * Serializes a user's feeds into an OPML 2.0 document string.
 */
export function serializeOpml(feeds: OpmlExportFeed[]): string {
  const outlines = feeds.map(serializeOutline).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Reader feed subscriptions</title>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}
