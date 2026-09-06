// Marketing/conversion pages that never require an authenticated session.
// Shared by the auth middleware (redirect gate) and the appearance store /
// app shell (first-paint cloak + settings-fetch skip) so the two lists can
// never drift apart.
export const PUBLIC_PATHS = ["/", "/pricing", "/about", "/privacy", "/contact"];

const LOGIN_PATH = "/login";

// Normalizes a single trailing slash so "/pricing/" matches "/pricing".
export function normalizePath(path: string): string {
  return path.replace(/(.)\/$/, "$1");
}

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(normalizePath(path));
}

// True for any route that's only ever rendered for a signed-out visitor —
// the marketing pages plus /login itself. The global auth middleware
// guarantees this split: it redirects signed-in visitors away from "/" and
// "/login", and redirects signed-out visitors away from everything else.
// Callers that need to know "is there an authenticated user's theme to load
// here" can check this synchronously from the route, without waiting on
// Clerk's async isSignedIn/isLoaded state.
export function isUnauthenticatedRoute(path: string): boolean {
  return isPublicPath(path) || normalizePath(path) === LOGIN_PATH;
}
