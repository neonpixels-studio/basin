import { SITE_NAME, canonicalUrl } from "~/utils/siteMeta";

// Applies the shared og:/twitter:/canonical meta every public marketing page
// needs (app/pages/index.vue, pricing.vue, about.vue, privacy.vue,
// contact.vue) — each page previously repeated this same useSeoMeta/useHead
// block with only the title/description swapped, which `fallow audit`
// flagged as duplicated code across all five files.
export function useMarketingSeo(title: string, description: string): void {
  const pageUrl = canonicalUrl(useRoute().path);

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

  useHead({
    link: [{ rel: "canonical", href: pageUrl }],
  });
}
