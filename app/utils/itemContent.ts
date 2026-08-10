// Label shown on the striped placeholder when a video item has no thumbnail
// image (imageUrl is null). Shared by the feed card and the detail view.
export const VIDEO_PLACEHOLDER_LABEL = "video";

const HTML_TAG = /<[^>]*>/g;
const NUMERIC_ENTITY = /&#(\d+);/g;
const HEX_ENTITY = /&#x([0-9a-f]+);/gi;
const NAMED_ENTITY = /&[a-z]+;/gi;
const WHITESPACE = /\s+/g;

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY, (_, code) => String.fromCodePoint(Number(code)))
    .replace(HEX_ENTITY, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(NAMED_ENTITY, (entity) => NAMED_ENTITIES[entity] ?? entity);
}

// Turns a synced item's `content` into a single line of plain text for card
// previews, or "" when absent — so cards render real feed text (CSS clamps
// length) instead of a mock `text`/`excerpt` field or a blank. Feed `content`
// is often an HTML snippet (RSS content:encoded, itunes:summary), so strip tags
// and decode entities here; otherwise the escaped markup shows verbatim.
export function contentText(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }
  const withoutTags = content.replace(HTML_TAG, " ");
  return decodeEntities(withoutTags).replace(WHITESPACE, " ").trim();
}
