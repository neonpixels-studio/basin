import { buildSitemap } from "../utils/sitemap";
import { getConfiguredSiteUrl } from "../utils/siteUrl";

export default defineEventHandler((event) => {
  // Resolve (and let a misconfigured NUXT_SITE_URL throw) before setting the
  // header, so a 500 response isn't mislabeled as application/xml.
  const body = buildSitemap(getConfiguredSiteUrl());
  setHeader(event, "Content-Type", "application/xml; charset=utf-8");
  return body;
});
