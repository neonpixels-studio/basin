// Same-origin / CSRF guard for state-changing API routes, isolated here as a
// pure seam so the classification logic can be unit-tested without an HTTP
// layer. server/middleware/csrf.ts is the only production caller; it reads the
// request headers and turns a rejection into a 403.
//
// THREAT MODEL: cross-site request forgery is a browser-only vector — a
// malicious page (evil.example) tricking a logged-in user's browser into
// firing a state-changing request at basin, riding the user's Clerk session
// cookie. The browser attaches the cookie automatically (ambient authority),
// so the request authenticates even though the user never intended it. The
// defense is to confirm the request actually came from basin's own pages.
//
// SIGNALS: modern browsers send `Sec-Fetch-Site`, which the page's JavaScript
// cannot forge (it's a forbidden header). When present it is authoritative.
// When absent (older browsers, or a non-browser client like curl) we fall back
// to the `Origin` header. A non-browser client with no Origin is not a CSRF
// vector — it isn't riding a victim's ambient cookie — so it is allowed; if it
// carries a stolen cookie it already has full access and CSRF is not the
// relevant control.

export const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Machine-to-machine endpoints that authenticate by request signature and have
// no browser Origin: Stripe delivers webhooks from its own IP pool with a
// signed payload the handler verifies. These must never be subject to the
// origin check — Stripe sends neither an Origin nor a Sec-Fetch-Site header, so
// a stray proxy that added one must not be able to lock the webhook out.
// Matched exactly (not by prefix) so a look-alike like
// /api/billing/webhook-test can't inherit the exemption.
export const ORIGIN_CHECK_EXEMPT_PATHS = ["/api/billing/webhook"];

// Trusted origins beyond the request's own origin (same host it was served
// from). Empty today: basin serves its app and marketing pages from a single
// origin, so same-origin covers every legitimate caller. A future second
// front-end domain that must POST here would be added explicitly.
export const ADDITIONAL_ALLOWED_ORIGINS: string[] = [];

// Sec-Fetch-Site values that mean the request originated from our own site (or
// was user-initiated and not from any site). `cross-site` — and anything
// unrecognized — is rejected, so the check fails closed.
const TRUSTED_FETCH_SITE_VALUES = new Set(["same-origin", "same-site", "none"]);

export interface OriginCheckInput {
  origin: string | null;
  secFetchSite: string | null;
  targetOrigin: string;
}

function isSafeMethod(method: string): boolean {
  return SAFE_HTTP_METHODS.has(method.toUpperCase());
}

function isExemptPath(path: string): boolean {
  return ORIGIN_CHECK_EXEMPT_PATHS.includes(path);
}

// True when the request must pass the origin check: a state-changing (unsafe)
// method on a non-exempt API route. Non-/api paths and safe reads are ignored.
export function requiresOriginCheck(method: string, path: string): boolean {
  if (!path.startsWith("/api/")) {
    return false;
  }
  if (isSafeMethod(method)) {
    return false;
  }
  if (isExemptPath(path)) {
    return false;
  }
  return true;
}

function isTrustedOrigin(origin: string, targetOrigin: string): boolean {
  if (origin === targetOrigin) {
    return true;
  }
  return ADDITIONAL_ALLOWED_ORIGINS.includes(origin);
}

// Decides whether a state-changing request is allowed. Assumes the caller has
// already confirmed the request requires the check (see requiresOriginCheck).
export function isRequestOriginAllowed(input: OriginCheckInput): boolean {
  if (input.secFetchSite) {
    return TRUSTED_FETCH_SITE_VALUES.has(input.secFetchSite);
  }
  if (!input.origin) {
    return true;
  }
  return isTrustedOrigin(input.origin, input.targetOrigin);
}
