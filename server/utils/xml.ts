// Shared XML text-escaping, used anywhere server code serializes untrusted
// or dynamic values into an XML document (OPML export, sitemap.xml). Escapes
// the full set required for both text content (&, <, >) and attribute values
// ("), '") so callers don't need to know which context their string ends up
// in — over-escaping a text node is harmless, under-escaping an attribute
// produces a malformed document.
export function escapeXmlEntities(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("'")
    .join("&apos;");
}
