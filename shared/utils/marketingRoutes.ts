// Single source of truth for basin's public marketing routes — the pages
// reachable without signing in. app/middleware/auth.global.ts (gating
// access), server/utils/sitemap.ts (advertising these routes to crawlers),
// and app/utils/publicPaths.ts (the app shell's first-paint cloak skip) all
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

// The one route every layer agrees is the sign-in page — kept alongside
// MARKETING_ROUTES rather than duplicated per-layer so a future rename only
// happens here.
export const LOGIN_PATH = "/login";

// Strips a single trailing slash from a route path (but never collapses the
// root "/" itself). Both the auth middleware (checking a path against
// MARKETING_ROUTES) and useMarketingSeo (building the canonical/og:url for
// the current route) need the same normalized shape, so "/pricing/" is
// treated identically to "/pricing" in both places instead of one
// recognizing it and the other emitting a second, non-canonical URL for the
// same page.
//
// Guards against a non-string input (e.g. an ambient route mock missing
// `path`) so callers get a clean "not a known path" rather than a throw —
// this runs inside a global route middleware, where an uncaught throw would
// break every navigation, not just the one that triggered it.
export function normalizeRoutePath(path: string): string {
  if (typeof path !== "string") {
    return "";
  }
  return path.replace(/(.)\/$/, "$1");
}

// Whether `path` is one of the public marketing routes, trailing slash and
// all. The one predicate every caller (auth gate, cloak skip) should use
// instead of normalizing and checking MARKETING_ROUTES.includes() inline,
// so the pairing of "normalize, then match" can't be dropped by a future
// call site.
export function isMarketingRoute(path: string): boolean {
  return MARKETING_ROUTES.includes(normalizeRoutePath(path));
}
