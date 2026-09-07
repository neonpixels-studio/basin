// Shared building blocks for every marketing page's useMarketingSeo() call.

export const SITE_NAME = "Reader";

const ALLOWED_SITE_URL_PROTOCOLS = new Set(["http:", "https:"]);

// Builds an absolute URL anchored to the *configured* site origin, never the
// request Host (mirrors server/utils/siteUrl.ts's getConfiguredSiteUrl, used
// server-side for the same reason). Reads runtimeConfig.public.siteUrl,
// since the private `siteUrl` key resolves to empty once the client takes
// over after hydration.
//
// Returns undefined — rather than a relative or malformed URL — when
// NUXT_SITE_URL is missing, unparseable, or not http(s): a relative/invalid
// canonical would resolve against whatever host served the page, exactly the
// spoofable-Host outcome this function exists to avoid. Callers omit
// ogUrl/canonical in that case instead of shipping a wrong one; unlike
// getConfiguredSiteUrl, this degrades quietly rather than failing the page.
export function canonicalUrl(path: string): string | undefined {
  const { siteUrl } = useRuntimeConfig().public;
  if (!siteUrl) {
    return undefined;
  }

  let parsedSiteUrl: URL;
  try {
    parsedSiteUrl = new URL(siteUrl);
  } catch {
    return undefined;
  }

  if (!ALLOWED_SITE_URL_PROTOCOLS.has(parsedSiteUrl.protocol)) {
    return undefined;
  }

  return `${parsedSiteUrl.origin}${path}`;
}
