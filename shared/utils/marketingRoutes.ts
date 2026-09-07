// Single source of truth for basin's public marketing routes — the pages
// reachable without signing in. Both app/middleware/auth.global.ts (gating
// access) and server/utils/sitemap.ts (advertising these routes to crawlers)
// need the exact same list, so it lives in shared/ where both the app and
// server layers can import it via the #shared alias. Import it that way, not
// with a relative path across the app/server boundary — that has silently
// broken the Nitro production build before even though lint and tests still
// pass, because the two layers bundle separately.
export const MARKETING_ROUTES: readonly string[] = [
  "/",
  "/pricing",
  "/about",
  "/privacy",
  "/contact",
];

// Strips a single trailing slash from a route path (but never collapses the
// root "/" itself). Both the auth middleware (checking a path against
// MARKETING_ROUTES) and useMarketingSeo (building the canonical/og:url for
// the current route) need the same normalized shape, so "/pricing/" is
// treated identically to "/pricing" in both places instead of one
// recognizing it and the other emitting a second, non-canonical URL for the
// same page.
export function normalizeRoutePath(path: string): string {
  return path.replace(/(.)\/$/, "$1");
}
