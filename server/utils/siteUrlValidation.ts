// Pure, framework-independent validation rules for basin's own public base
// URL (NUXT_SITE_URL). Deliberately has zero Nuxt/Nitro auto-imports
// (useRuntimeConfig, createError) so the exact same rules can run in two
// different contexts from one source of truth instead of two copies:
//   - request time: server/utils/siteUrl.ts wraps this in createError() so a
//     misconfigured value 500s the request that needs it.
//   - build time: nuxt.config.ts imports this directly (it loads before
//     Nuxt's auto-import pipeline exists, so it cannot call useRuntimeConfig
//     or createError) to fail the build instead of shipping a bad value that
//     only surfaces on the first OAuth Connect click or billing redirect.

const ALLOWED_SITE_URL_PROTOCOLS = new Set(["http:", "https:"]);

export type SiteUrlValidationResult =
  { valid: true; origin: string } | { valid: false; message: string };

// Rejects rather than silently stripping anything beyond the origin: callers
// join their own redirect paths onto this origin, so a configured base like
// https://basin.example/app would drop `/app` and bounce to the wrong place,
// and embedded credentials (user:pass@host) would likewise vanish. A bare
// origin with a root path ("/") is allowed.
function hasExtraneousParts(parsedSiteUrl: URL): boolean {
  return (
    parsedSiteUrl.pathname !== "/" ||
    parsedSiteUrl.search !== "" ||
    parsedSiteUrl.hash !== "" ||
    parsedSiteUrl.username !== "" ||
    parsedSiteUrl.password !== ""
  );
}

export function validateSiteUrl(
  rawSiteUrl: string | undefined,
): SiteUrlValidationResult {
  if (!rawSiteUrl) {
    return {
      valid: false,
      message: "Site URL is not configured: missing NUXT_SITE_URL",
    };
  }

  let parsedSiteUrl: URL;
  try {
    parsedSiteUrl = new URL(rawSiteUrl);
  } catch {
    return {
      valid: false,
      message: "Site URL is not configured as a valid absolute URL",
    };
  }

  if (!ALLOWED_SITE_URL_PROTOCOLS.has(parsedSiteUrl.protocol)) {
    return {
      valid: false,
      message: "Site URL must use the http or https protocol",
    };
  }

  if (hasExtraneousParts(parsedSiteUrl)) {
    return {
      valid: false,
      message:
        "Site URL must be a bare origin with no path, query, fragment, or credentials",
    };
  }

  return { valid: true, origin: parsedSiteUrl.origin };
}
