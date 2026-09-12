import {
  LOGIN_PATH,
  normalizeRoutePath,
  isMarketingRoute,
} from "#shared/utils/marketingRoutes";

// Routes where the first-paint opacity cloak should never apply: the
// marketing pages (see shared/utils/marketingRoutes.ts, the source of truth
// also used by the auth middleware and server-side sitemap.xml) plus
// /login. This is a route-only concept, independent of who is actually
// looking at it — a signed-in visitor can still browse /pricing (the auth
// middleware only redirects signed-in visitors away from "/" and "/login",
// not the rest of the marketing routes), and these pages don't depend on
// that visitor's personalized theme to render correctly. Whether their
// authenticated settings actually get fetched is a separate decision the
// appearance store makes from real auth state, not from the route.
export function isCloakExemptPath(path: string): boolean {
  return isMarketingRoute(path) || normalizeRoutePath(path) === LOGIN_PATH;
}
