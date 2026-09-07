// Building blocks shared by every public marketing page's useSeoMeta/useHead
// call (app/pages/index.vue, pricing.vue, about.vue, privacy.vue,
// contact.vue) — kept here once instead of duplicated across all five.

export const SITE_NAME = "Reader";

// Builds an absolute URL for a marketing page's canonical link / og:url,
// anchored to the *configured* site origin rather than the request Host —
// same principle as server/utils/siteUrl.ts's getConfiguredSiteUrl, which the
// server layer already uses so OAuth/billing redirects can't be steered by a
// forged Host header. This is the app-layer equivalent: it reads
// runtimeConfig.public.siteUrl (see nuxt.config.ts) rather than the private
// `siteUrl` key, because the private key resolves to empty in the browser
// once the client takes over after hydration and og:url/canonical are
// rendered from universal (SSR + client) code, not server-only code.
//
// Returns undefined when NUXT_SITE_URL isn't configured, rather than falling
// back to a bare relative path: a relative og:url/canonical resolves against
// whatever host actually served the page — exactly the spoofable-Host
// behavior this function exists to avoid — so a missing config must omit the
// tag, not silently ship a wrong one. Callers (see useMarketingSeo) skip
// emitting ogUrl/canonical entirely in that case; this intentionally
// degrades quietly rather than 500ing the whole page (unlike
// getConfiguredSiteUrl, a broken og:url/canonical isn't worth taking the
// public marketing surface down over).
export function canonicalUrl(path: string): string | undefined {
  const { siteUrl } = useRuntimeConfig().public;
  if (!siteUrl) {
    return undefined;
  }
  return `${siteUrl.replace(/\/+$/, "")}${path}`;
}
