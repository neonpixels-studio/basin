// Builds the robots.txt body, isolated from the Nitro route handler (see
// server/routes/robots.txt.ts) so it's unit-testable without an HTTP event.
//
// Generated rather than a static public/ file solely because the Sitemap
// directive must carry a fully-qualified URL (see server/utils/sitemap.ts) —
// a static file would have to hardcode one origin and be wrong on every
// environment except the one it was written for (this same build serves
// dev/preview/production, each with a different configured site URL).
// Everything else here is fixed, unchanging content.

// Auth-gated app surfaces (see app/middleware/auth.global.ts) that crawlers
// shouldn't index — kept separate from shared/utils/marketingRoutes.ts's
// allow-list since this is a deny-list of a different, smaller set of routes.
const DISALLOWED_PATHS = ["/dashboard", "/settings", "/login"];

// `origin` is undefined when NUXT_SITE_URL isn't configured (see
// server/routes/robots.txt.ts, which catches getConfiguredSiteUrl's throw
// rather than propagating it here) — the Sitemap directive is simply
// omitted in that case. A 5xx robots.txt gets treated by crawlers as
// "disallow everything," which is worse than serving crawl rules without a
// sitemap pointer, so this must never throw on a missing/malformed origin.
export function buildRobotsTxt(origin: string | undefined): string {
  const disallowLines = DISALLOWED_PATHS.map(
    (path) => `Disallow: ${path}`,
  ).join("\n");
  // Unlisted paths are already crawlable by default per the robots.txt spec,
  // so there's no separate "Allow: /" directive to state that — and stating
  // it would sit alongside the Disallow lines below in a way that's easy to
  // misread as contradicting them.
  const sitemapLine = origin ? `\nSitemap: ${origin}/sitemap.xml\n` : "";

  return `User-agent: *\n${disallowLines}\n${sitemapLine}`;
}
