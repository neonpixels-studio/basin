import { SITE_NAME, canonicalUrl } from "~/utils/siteMeta";
import { normalizeRoutePath } from "#shared/utils/marketingRoutes";

// Applies the og:/twitter:/canonical meta every public marketing page needs.
// @todo Add ogImage/twitterImage once a marketing image asset exists —
// there's currently nothing in public/ or app/assets/ to point at (the
// favicon is an inline SVG data URI, not a usable social-preview image).
export function useMarketingSeo(title: string, description: string): void {
  const pageUrl = canonicalUrl(normalizeRoutePath(useRoute().path));

  useSeoMeta({
    title,
    description,
    ogTitle: title,
    ogDescription: description,
    ogType: "website",
    ogUrl: pageUrl,
    ogSiteName: SITE_NAME,
    twitterCard: "summary",
    twitterTitle: title,
    twitterDescription: description,
  });

  // canonicalUrl returns undefined when NUXT_SITE_URL isn't configured — omit
  // the canonical link entirely rather than emit one resolved against the
  // request Host (see canonicalUrl's own comment for why that's unsafe).
  if (!pageUrl) {
    return;
  }

  useHead({
    link: [{ rel: "canonical", href: pageUrl }],
  });
}
