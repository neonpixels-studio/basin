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
const HREF_ATTR = "href";

// Links in feed content open the origin site; force them into a new tab and
// strip the opener reference so the target page can't reach back into the app.
// Only anchors that kept a (safe, allowlisted) href are hardened — an anchor
// whose href was rejected (relative or unsafe protocol) is left as plain text,
// not stamped with a misleading target on a dead link.
function hardenAnchor(node: Element): void {
  if (node.tagName !== ANCHOR_TAG_NAME || !node.hasAttribute(HREF_ATTR)) {
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
}

// The hook is registered on the shared DOMPurify singleton, so it affects every
// sanitize call in the app. sanitizeFeedHtml is the only caller, and hardening
// an allowlisted anchor is safe for any HTML, so a single global registration
// is fine here — revisit (dedicated instance / removeHook) if another sink
// starts using DOMPurify with different anchor expectations.
let hooksInstalled = false;

function installHooksOnce(): void {
  if (hooksInstalled) {
    return;
  }
  DOMPurify.addHook("afterSanitizeAttributes", hardenAnchor);
  hooksInstalled = true;
}

// Returns a sanitized, allowlisted HTML string safe to render, or "" for
// non-string/blank input or when no DOM is available — never the raw,
// unsanitized markup. The "" on no-DOM guards SSR: this app only renders feed
// content client-side (the reader detail is behind `v-if` on a client-set
// active item), so the server never produces markup to mismatch against on
// hydration.
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
    // ALLOWED_ATTR does not by itself drop data-*/aria-*; disable them
    // explicitly so only href/title survive, as the allowlist intends.
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
