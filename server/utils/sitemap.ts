// Builds the sitemap.xml body, isolated from the Nitro route handler (see
// server/routes/sitemap.xml.ts) so it's unit-testable without an HTTP event —
// mirrors server/utils/opml.ts's split between pure serialization and the
// handler that wires it to a response.

import { MARKETING_ROUTES } from "#shared/utils/marketingRoutes";

function escapeXmlEntities(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
}

// Exported so escaping is directly testable — MARKETING_ROUTES is a fixed,
// hardcoded list today with nothing to escape, but this guards against a
// future entry (or origin) containing XML-significant characters.
export function serializeUrlEntry(origin: string, path: string): string {
  const location = escapeXmlEntities(`${origin}${path}`);
  return `  <url>\n    <loc>${location}</loc>\n  </url>`;
}

// `origin` must be a bare scheme://host[:port] (no trailing slash or path) —
// see server/utils/siteUrl.ts's getConfiguredSiteUrl, the caller in
// server/routes/sitemap.xml.ts. The <loc> spec requires a fully-qualified
// absolute URL, so this never emits a relative or origin-less path.
export function buildSitemap(origin: string): string {
  const urlEntries = MARKETING_ROUTES.map((path) =>
    serializeUrlEntry(origin, path),
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;
}
