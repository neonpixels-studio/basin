import { SITE_NAME, canonicalUrl } from "~/utils/siteMeta";
import { normalizeRoutePath } from "#shared/utils/marketingRoutes";

// Applies the shared og:/twitter:/canonical meta every public marketing page
// needs (app/pages/index.vue, pricing.vue, about.vue, privacy.vue,
// contact.vue) — each page previously repeated this same useSeoMeta/useHead
// block with only the title/description swapped, which `fallow audit`
// flagged as duplicated code across all five files.
//
// No og:image/twitter:image: Reader has no marketing image asset anywhere in
// public/ or app/assets/ to point at yet (the favicon is an inline SVG data
// URI, not a usable social-preview image). Shipping a placeholder image
// here would be a worse look than no image, so this is a deliberate gap —
// see the has-suggestions follow-up on this PR — not an oversight.
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
