// Label shown on the striped placeholder when a video item has no thumbnail
// image (imageUrl is null). Shared by the feed card and the detail view.
export const VIDEO_PLACEHOLDER_LABEL = "video";

const WHITESPACE = /\s+/g;

// Collapses a synced item's `content` to a single line of plain text, or ""
// when it is absent — so card previews render real text (CSS clamps length)
// instead of a mock `text`/`excerpt` field or a blank.
export function contentText(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }
  return content.replace(WHITESPACE, " ").trim();
}
