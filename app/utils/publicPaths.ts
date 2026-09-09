// Marketing/conversion pages that never require an authenticated session.
// Re-exported from shared/utils/marketingRoutes.ts (the actual source of
// truth — server code needs the same list for sitemap.xml, which can't
// import from app/) rather than duplicated here, so the auth middleware's
// redirect gate and the app shell's first-paint cloak skip can never drift
// apart.
import {
  MARKETING_ROUTES,
  LOGIN_PATH,
  normalizeRoutePath,
  isMarketingRoute,
} from "#shared/utils/marketingRoutes";

export const PUBLIC_PATHS = MARKETING_ROUTES;
export { LOGIN_PATH };
export const normalizePath = normalizeRoutePath;
export const isPublicPath = isMarketingRoute;

// Routes where the first-paint opacity cloak should never apply: the
// marketing pages plus /login. This is a route-only concept, independent of
// who is actually looking at it — a signed-in visitor can still browse
// /pricing (the auth middleware only redirects signed-in visitors away from
// "/" and "/login", not the rest of PUBLIC_PATHS), and these pages don't
// depend on that visitor's personalized theme to render correctly. Whether
// their authenticated settings actually get fetched is a separate decision
// the appearance store makes from real auth state, not from the route.
export function isCloakExemptPath(path: string): boolean {
  return isPublicPath(path) || normalizePath(path) === LOGIN_PATH;
}
