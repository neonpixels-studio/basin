import DOMPurify from "dompurify";

// Feed content (RSS content:encoded, podcast itunes:summary) can carry HTML.
// This module is the single place that turns that untrusted markup into a safe
// HTML string, so the detail view can render real formatting instead of escaped
// tags. Isolated behind sanitizeFeedHtml so the allowlist and DOMPurify
// integration are configured once and can be unit-tested on their own.

// Formatting and structural tags feeds legitimately use. Everything outside this
// set (script, iframe, style, img, form, object, …) is stripped by DOMPurify.
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "div",
  "span",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "figure",
  "figcaption",
  "blockquote",
  "pre",
  "code",
  "kbd",
  "samp",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "sub",
  "sup",
  "abbr",
  "cite",
  "q",
  "a",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

// Block-level members of the allowlist. Consumers use this to tell whether a
// chunk already carries its own paragraph structure (so it should render as-is)
// or is inline/text that needs wrapping in a <p>.
export const BLOCK_LEVEL_TAGS = [
  "p",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "figure",
  "figcaption",
  "blockquote",
  "pre",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

// Full set of standard HTML element names used only to decide whether a string
// is markup at all. Broader than the allowlist on purpose: a `<table>` or
// `<script>` string is still "markup" (sanitize then keeps or drops it), whereas
// a bare `<env>` or `3 < 5` in prose is not, so plain text is never mistaken for
// markup and mangled by the sanitizer.
const HTML_ELEMENT_NAMES = [
  ...ALLOWED_TAGS,
  "main",
  "nav",
  "col",
  "colgroup",
  "img",
  "picture",
  "source",
  "audio",
  "video",
  "track",
  "iframe",
  "embed",
  "object",
  "param",
  "form",
  "input",
  "button",
  "select",
  "option",
  "textarea",
  "label",
  "fieldset",
  "legend",
  "details",
  "summary",
  "dialog",
  "script",
  "style",
  "link",
  "meta",
  "svg",
  "canvas",
  "center",
  "font",
  "big",
  "noscript",
  "wbr",
  "time",
  "var",
];

// Matches a well-formed opening/closing tag for any of the given names: either a
// bare tag (`<p>`, `</p>`, `<br/>`) or a tag with a real attribute
// (`<a href="…">`). Requiring that shape — not just a boundary char — keeps a
// prose inequality like `if a<b and b>c` from looking like a `<b>` tag, which
// the sanitizer would then parse and silently delete the words inside.
function tagNameRegExp(names: string[]): RegExp {
  const name = `(?:${names.join("|")})`;
  return new RegExp(`<\\/?${name}\\s*\\/?>|<${name}\\s+[a-z-]+\\s*=`, "i");
}

const BLOCK_LEVEL_MARKUP = tagNameRegExp(BLOCK_LEVEL_TAGS);
const HTML_MARKUP = tagNameRegExp(HTML_ELEMENT_NAMES);

// True when the content contains at least one recognized HTML tag, so it should
// take the sanitize-and-render path rather than the plain-text one.
export function looksLikeHtml(content: string): boolean {
  return HTML_MARKUP.test(content);
}

// True when the (already-sanitized) markup carries its own block structure.
export function hasBlockLevelMarkup(html: string): boolean {
  return BLOCK_LEVEL_MARKUP.test(html);
}

// Only the attributes needed to render links and titles survive; every style,
// event-handler (onclick, onerror, …) and script attribute is dropped.
const ALLOWED_ATTR = ["href", "title"];

// href may only point at these protocols; a crafted javascript:/data:/vbscript:
// URL is rejected so it can't execute when clicked.
const SAFE_URI_REGEXP = /^(?:https?|mailto):/i;

const ANCHOR_TAG_NAME = "A";
const HREF_ATTR = "href";

// Open feed links in a new tab and drop the opener reference. Only anchors that
// kept a safe href are hardened, so a rejected (relative/unsafe) link isn't left
// as a dead anchor stamped with a misleading target.
function hardenAnchor(node: Element): void {
  if (node.tagName !== ANCHOR_TAG_NAME || !node.hasAttribute(HREF_ATTR)) {
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
}

// A DOMPurify instance dedicated to this module so the anchor hook doesn't leak
// onto the shared singleton other code (or a future dependency) might use. Built
// lazily against the real window; null on the server, where there is no DOM.
let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> | null {
  if (purifier) {
    return purifier;
  }
  if (typeof window === "undefined") {
    return null;
  }
  const instance = DOMPurify(window);
  instance.addHook("afterSanitizeAttributes", hardenAnchor);
  purifier = instance;
  return purifier;
}

// Returns sanitized, allowlisted HTML safe to render, or "" for non-string/blank
// input or when no DOM is available — never raw markup. The no-DOM "" guards
// SSR: feed content is only rendered client-side (the reader detail is behind a
// `v-if` on a client-set active item), so the server never emits markup that
// could mismatch on hydration.
export function sanitizeFeedHtml(html: unknown): string {
  if (typeof html !== "string" || html.trim() === "") {
    return "";
  }
  const purify = getPurifier();
  if (!purify || !purify.isSupported) {
    return "";
  }
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
    // ALLOWED_ATTR does not by itself drop data-*/aria-*; disable them so only
    // href/title survive, as the allowlist intends.
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
