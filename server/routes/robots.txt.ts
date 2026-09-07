import { buildRobotsTxt } from "../utils/robots";
import { getConfiguredSiteUrl } from "../utils/siteUrl";

// Unlike sitemap.xml, this must never fail the request over a
// missing/malformed NUXT_SITE_URL — a 5xx robots.txt is treated by crawlers
// as "disallow everything," so a misconfigured origin degrades to omitting
// the Sitemap directive (see buildRobotsTxt) instead.
function resolveSiteUrlOrUndefined(): string | undefined {
  try {
    return getConfiguredSiteUrl();
  } catch {
    return undefined;
  }
}

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "text/plain; charset=utf-8");
  return buildRobotsTxt(resolveSiteUrlOrUndefined());
});
