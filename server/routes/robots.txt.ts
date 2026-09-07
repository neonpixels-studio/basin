import { buildRobotsTxt } from "../utils/robots";
import { getConfiguredSiteUrl } from "../utils/siteUrl";

export default defineEventHandler((event) => {
  setHeader(event, "Content-Type", "text/plain; charset=utf-8");
  return buildRobotsTxt(getConfiguredSiteUrl());
});
