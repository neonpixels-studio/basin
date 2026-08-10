// Label shown on the striped placeholder when a video item has no thumbnail
// image (imageUrl is null). Shared by the feed card and the detail view.
export const VIDEO_PLACEHOLDER_LABEL = "video";

const WHITESPACE = /\s+/g;

// Collapses a synced item's `content` (a server-provided text snippet) to a
// single line, or "" when absent — so card previews render real feed text (CSS
// clamps length) instead of a mock `text`/`excerpt` field or a blank. Any HTML
// that slips through is rendered as escaped text, matching the feed store's
// contentParagraphs; sanitizing/rendering markup is a tracked follow-up there.
export function contentText(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }
  return content.replace(WHITESPACE, " ").trim();
}
