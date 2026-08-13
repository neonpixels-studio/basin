import DOMPurify from "dompurify";

// Feed content (RSS content:encoded, podcast itunes:summary) can carry HTML.
// This module is the single place that turns that untrusted markup into a safe
// HTML string, so the detail view can render real formatting instead of escaped
// tags. It is isolated here — behind sanitizeFeedHtml — so the allowlist and the
// DOMPurify integration are configured once and can be unit-tested on their own.

// Formatting tags feeds legitimately use. Everything outside this set (script,
// iframe, style, img, form, etc.) is stripped by DOMPurify.
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "span",
];

// Only the attributes needed to render links and titles survive; every style,
// event-handler (onclick, onerror, …) and script attribute is dropped.
const ALLOWED_ATTR = ["href", "title"];

// href/src may only point at these protocols. A crafted javascript:, data: or
// vbscript: URL is rejected, so it can't execute script when clicked.
const SAFE_URI_REGEXP = /^(?:https?|mailto):/i;

const ANCHOR_TAG_NAME = "A";

// Links in feed content open the origin site; force them into a new tab and
// strip the opener reference so the target page can't reach back into the app.
function hardenAnchor(node: Element): void {
  if (node.tagName !== ANCHOR_TAG_NAME) {
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
}

let hooksInstalled = false;

function installHooksOnce(): void {
  if (hooksInstalled) {
    return;
  }
  DOMPurify.addHook("afterSanitizeAttributes", hardenAnchor);
  hooksInstalled = true;
}

// Returns a sanitized, allowlisted HTML string safe to render, or "" for
// non-string/blank input or when no DOM is available (SSR) — never the raw,
// unsanitized markup.
export function sanitizeFeedHtml(html: unknown): string {
  if (typeof html !== "string" || html.trim() === "") {
    return "";
  }
  if (!DOMPurify.isSupported) {
    return "";
  }
  installHooksOnce();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  });
}
