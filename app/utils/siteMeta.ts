// Shared building blocks for every marketing page's useMarketingSeo() call.

export const SITE_NAME = "Reader";

const ALLOWED_SITE_URL_PROTOCOLS = new Set(["http:", "https:"]);

// Same validity bar as server/utils/siteUrl.ts's getConfiguredSiteUrl: a bare
// origin, http(s) only, no path/query/fragment/credentials. Kept in sync so
// the two layers agree on which configured values are usable — they only
// differ in how they respond to an invalid one (throw vs. omit the tag; see
// canonicalUrl below).
function isValidSiteOrigin(parsedSiteUrl: URL): boolean {
  if (!ALLOWED_SITE_URL_PROTOCOLS.has(parsedSiteUrl.protocol)) {
    return false;
  }
  return (
    parsedSiteUrl.pathname === "/" &&
    parsedSiteUrl.search === "" &&
    parsedSiteUrl.hash === "" &&
    parsedSiteUrl.username === "" &&
    parsedSiteUrl.password === ""
  );
}

// Builds an absolute URL anchored to the *configured* site origin, never the
// request Host (mirrors getConfiguredSiteUrl, used server-side for the same
// reason). Reads runtimeConfig.public.siteUrl, since the private `siteUrl`
// key resolves to empty once the client takes over after hydration.
//
// Returns undefined — rather than a relative or malformed URL — when
// NUXT_SITE_URL is missing or invalid: a relative/wrong-origin canonical
// resolves against whatever host served the page, exactly the
// spoofable-Host outcome this function exists to avoid. Callers omit
// ogUrl/canonical in that case instead of shipping a wrong one; unlike
// getConfiguredSiteUrl, this degrades quietly rather than failing the page.
export function canonicalUrl(path: string): string | undefined {
  // normalizeRoutePath returns "" for a non-string route path (see its own
  // guard comment), and any caller could otherwise pass a value that isn't
  // rooted at "/" — joining that straight onto the origin would emit a
  // canonical for the wrong page ("" → the homepage) or a malformed URL
  // ("pricing" → "https://reader.examplepricing"). Treat both as "no known
  // path" the same way a missing/invalid site URL is treated.
  if (!path.startsWith("/")) {
    return undefined;
  }

  const { siteUrl } = useRuntimeConfig().public ?? {};
  if (!siteUrl) {
    return undefined;
  }

  let parsedSiteUrl: URL;
  try {
    parsedSiteUrl = new URL(siteUrl);
  } catch {
    return undefined;
  }

  if (!isValidSiteOrigin(parsedSiteUrl)) {
    return undefined;
  }

  return `${parsedSiteUrl.origin}${path}`;
}
