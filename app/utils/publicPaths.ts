// Marketing/conversion pages that never require an authenticated session.
// Shared by the auth middleware (redirect gate) and the app shell's
// first-paint cloak skip so the two lists can never drift apart.
export const PUBLIC_PATHS = ["/", "/pricing", "/about", "/privacy", "/contact"];

const LOGIN_PATH = "/login";

// Normalizes a single trailing slash so "/pricing/" matches "/pricing".
export function normalizePath(path: string): string {
  return path.replace(/(.)\/$/, "$1");
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(normalizePath(path));
}

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
