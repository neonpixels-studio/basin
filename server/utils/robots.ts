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

export function buildRobotsTxt(origin: string): string {
  const disallowLines = DISALLOWED_PATHS.map(
    (path) => `Disallow: ${path}`,
  ).join("\n");

  return `User-agent: *
Allow: /
${disallowLines}

Sitemap: ${origin}/sitemap.xml
`;
}
