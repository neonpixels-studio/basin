import { randomBytes } from "node:crypto";
import { isConfiguredSiteUrlSecure } from "../../utils/siteUrl";

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  // Derive the redirect URI before planting the state cookie: if the site URL
  // is misconfigured this throws, and a 500 should not leave behind a 10-minute
  // oauth_state cookie the user can never redeem.
  const redirectUri = buildYouTubeCallbackUrl();

  const state = randomBytes(32).toString("hex");
  setCookie(event, "oauth_state_youtube", state, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    // Derived from the configured site origin (not hardcoded) so local http
    // dev keeps working while a real https deployment stops the CSRF state
    // cookie from being readable/overwritable over plain http.
    secure: isConfiguredSiteUrlSecure(),
  });

  return sendRedirect(event, buildYouTubeAuthUrl(redirectUri, state));
});
