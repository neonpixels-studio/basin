// Resolves basin's own public base URL from server config, isolated here as a
// small seam so the resolution + validation is unit-testable without an HTTP
// layer (mirrors server/utils/stripe.ts reading useRuntimeConfig).
//
// SECURITY: billing redirect targets (Stripe return_url / success_url /
// cancel_url) must be anchored to a trusted origin. Deriving them from the
// request's Host header lets a forged Host steer the post-billing bounce to an
// attacker's domain, so we read a configured value instead and never trust the
// request.
//
// The actual URL-shape rules (missing/malformed/wrong-protocol/non-bare-origin)
// live in ./siteUrlValidation, a plain module with no Nuxt auto-imports, so
// nuxt.config.ts can run the identical checks at build time (see
// requireSiteUrlForBuild there) and fail the deploy instead of only surfacing
// here on the first request that needs a site URL.
import { validateSiteUrl } from "./siteUrlValidation";

// Returns the configured site origin (scheme://host[:port], no trailing path)
// so callers can join redirect paths onto a trusted base. Throws a 500 when the
// value is missing or malformed rather than silently falling back to the
// request host.
export function getConfiguredSiteUrl(): string {
  const { siteUrl } = useRuntimeConfig();
  const validationResult = validateSiteUrl(siteUrl);
  if (!validationResult.valid) {
    throw createError({
      statusCode: 500,
      statusMessage: validationResult.message,
    });
  }
  return validationResult.origin;
}

// Whether the configured site origin is https. Cookies that must not travel
// over plain http (e.g. OAuth CSRF state) derive their `secure` flag from
// this instead of a hardcoded true/false, so local http dev still works while
// a real https deployment gets the flag it needs.
//
// Production must never resolve to a non-secure origin: this app's real
// deployments are always https, so an http siteUrl in production is a
// misconfiguration (proxy/TLS termination dropped, a copy-pasted staging
// value, a missing scheme upgrade), not a legitimate case to silently accept.
// Throwing here (rather than returning false, or returning true without
// validating anything) matches getConfiguredSiteUrl's fail-loud convention
// and names the actual problem instead of surfacing as an unexplained
// "Invalid OAuth state" 400 on the callback (mirrors the NODE_ENV production
// guard in nuxt.config.ts).
export function isConfiguredSiteUrlSecure(): boolean {
  const isSecureOrigin = getConfiguredSiteUrl().startsWith("https:");
  if (process.env.NODE_ENV === "production" && !isSecureOrigin) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Site URL must use https in production: the OAuth state cookie cannot be set securely",
    });
  }
  return isSecureOrigin;
}
