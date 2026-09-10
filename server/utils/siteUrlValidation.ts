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

// A production deploy is always https in practice, so an http origin there is
// a misconfiguration (proxy/TLS termination dropped, a copy-pasted staging
// value, a missing scheme upgrade), not a legitimate case. Shared by
// isConfiguredSiteUrlSecure (request time, siteUrl.ts) and
// requireValidSiteUrlForBuild (build time, below) so neither can drift out of
// sync on what "secure enough for production" means.
export function isSecureSiteOrigin(origin: string): boolean {
  return origin.startsWith("https:");
}

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

// The actual build-time guard nuxt.config.ts's requireSiteUrlForBuild calls.
// Lives here (rather than inline in nuxt.config.ts, alongside the other
// build guards) so it can be unit tested directly — nuxt.config.ts itself
// cannot be imported in tests, since `defineNuxtConfig` isn't a real global
// outside Nuxt's own config loader.
//
// isProductionBuild is passed in rather than read from process.env here so
// this stays a pure function of its inputs; nuxt.config.ts is still the only
// place that decides what "production build" means (see the isProductionBuild
// comment there — both `nuxt build` and `nuxt build:dev` count, only `nuxt
// dev` doesn't). Only blocks an actual deployable build, matching
// requireTokenEncryptionKeyForBuild/requireTombstonePepperForBuild, so `nuxt
// dev` still works without a site URL set.
export function requireValidSiteUrlForBuild(
  rawSiteUrl: string | undefined,
  isProductionBuild: boolean,
): string {
  if (!isProductionBuild) {
    return rawSiteUrl ?? "";
  }

  const validationResult = validateSiteUrl(rawSiteUrl);
  if (!validationResult.valid) {
    throw new Error(
      `${validationResult.message} — OAuth redirects and billing bounces ` +
        "need a trusted origin. Set NUXT_SITE_URL to a bare http(s) origin " +
        "in this environment's dotenvx file before building.",
    );
  }

  // Mirrors isConfiguredSiteUrlSecure's production-https requirement: without
  // this, a build with a misconfigured http:// production NUXT_SITE_URL would
  // still pass (the shape is valid) and only fail at request time on the
  // first OAuth Connect click — the exact failure this guard exists to catch
  // at build time instead.
  if (!isSecureSiteOrigin(validationResult.origin)) {
    throw new Error(
      "NUXT_SITE_URL must use https for a production build — the OAuth " +
        "state cookie cannot be set securely over http. Set NUXT_SITE_URL " +
        "to an https origin in this environment's dotenvx file.",
    );
  }

  return rawSiteUrl ?? "";
}
