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
  // Reject rather than silently strip anything beyond the origin: callers join
  // their own redirect paths onto this origin, so a configured base like
  // https://basin.example/app would drop `/app` and bounce to the wrong place,
  // and embedded credentials (user:pass@host) would likewise vanish. Fail loud
  // so the misconfiguration surfaces instead of producing a subtly broken
  // redirect. A bare origin with a root path ("/") is allowed.
  const hasExtraneousParts =
    parsedSiteUrl.pathname !== "/" ||
    parsedSiteUrl.search !== "" ||
    parsedSiteUrl.hash !== "" ||
    parsedSiteUrl.username !== "" ||
    parsedSiteUrl.password !== "";
  if (hasExtraneousParts) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Site URL must be a bare origin with no path, query, fragment, or credentials",
    });
  }
  return parsedSiteUrl.origin;
}
