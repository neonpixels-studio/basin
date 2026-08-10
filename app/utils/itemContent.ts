// Shared, empty-safe helper for turning a synced item's real `content` field
// into displayable plain text for card previews. The synced API returns
// `content` (never the legacy mock fields `text`/`excerpt`), which may be
// null or carry hard/soft newlines; collapse whitespace to a single line and
// let CSS (`-webkit-line-clamp`) handle truncation. Returns "" when the feed
// carried no content so the caller can hide the field instead of showing blanks.
const WHITESPACE = /\s+/g;

export function contentText(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }
  return content.replace(WHITESPACE, " ").trim();
}
