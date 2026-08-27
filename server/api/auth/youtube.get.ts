import { randomBytes } from "node:crypto";

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
  });

  return sendRedirect(event, buildYouTubeAuthUrl(redirectUri, state));
});
