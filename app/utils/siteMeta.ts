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
// Falls back to the bare path if NUXT_SITE_URL isn't configured (e.g. local
// `nuxt dev` without it set) so the tag degrades to a relative URL instead of
// emitting a broken "undefined/pricing".
export function canonicalUrl(path: string): string {
  const { siteUrl } = useRuntimeConfig().public;
  if (!siteUrl) {
    return path;
  }
  return `${siteUrl.replace(/\/+$/, "")}${path}`;
}
