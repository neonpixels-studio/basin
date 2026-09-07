import { buildSitemap } from "../utils/sitemap";
import { getConfiguredSiteUrl } from "../utils/siteUrl";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "application/xml; charset=utf-8");
  return buildSitemap(getConfiguredSiteUrl());
});
