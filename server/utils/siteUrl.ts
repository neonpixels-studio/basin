// Resolves basin's own public base URL from server config, isolated here as a
// small seam so the resolution + validation is unit-testable without an HTTP
// layer (mirrors server/utils/stripe.ts reading useRuntimeConfig).
//
// SECURITY: billing redirect targets (Stripe return_url / success_url /
// cancel_url) must be anchored to a trusted origin. Deriving them from the
// request's Host header lets a forged Host steer the post-billing bounce to an
// attacker's domain, so we read a configured value instead and never trust the
// request.

const ALLOWED_SITE_URL_PROTOCOLS = new Set(["http:", "https:"]);

function parseAbsoluteSiteUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: "Site URL is not configured as a valid absolute URL",
    });
  }
}

// Returns the configured site origin (scheme://host[:port], no trailing path)
// so callers can join redirect paths onto a trusted base. Throws a 500 when the
// value is missing or malformed rather than silently falling back to the
// request host.
export function getConfiguredSiteUrl(): string {
  const { siteUrl } = useRuntimeConfig();
  if (!siteUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: "Site URL is not configured: missing NUXT_SITE_URL",
    });
  }
  const parsedSiteUrl = parseAbsoluteSiteUrl(siteUrl);
  if (!ALLOWED_SITE_URL_PROTOCOLS.has(parsedSiteUrl.protocol)) {
    throw createError({
      statusCode: 500,
      statusMessage: "Site URL must use the http or https protocol",
    });
  }
  return parsedSiteUrl.origin;
}
