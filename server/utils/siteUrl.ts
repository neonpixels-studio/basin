// The app's public origin, anchored in server config (NUXT_SITE_URL) rather
// than derived from the incoming request. Deriving OAuth redirect URIs from the
// request origin trusts a client-controllable Host/X-Forwarded-Host header, so a
// forged header can point an OAuth callback at an attacker-controlled origin.
// Callbacks must be built from a value only the server controls.

const SITE_URL_MISCONFIGURED_MESSAGE = "Server configuration error";

function parseSiteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function siteUrlConfigError(detail: string) {
  // Log the specific misconfiguration server-side, but return a generic message
  // so the branded error page never echoes internal env-var details to the user.
  console.error(`Site URL misconfigured: ${detail}`);
  return createError({
    statusCode: 500,
    statusMessage: SITE_URL_MISCONFIGURED_MESSAGE,
  });
}

export function getConfiguredSiteUrl(): string {
  const { siteUrl } = useRuntimeConfig();
  const configuredValue = typeof siteUrl === "string" ? siteUrl.trim() : "";
  if (!configuredValue) {
    throw siteUrlConfigError("NUXT_SITE_URL is not set");
  }

  const parsedUrl = parseSiteUrl(configuredValue);
  if (!parsedUrl) {
    throw siteUrlConfigError(
      `NUXT_SITE_URL is not a valid absolute URL: ${configuredValue}`,
    );
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw siteUrlConfigError(
      `NUXT_SITE_URL must be an http(s) URL: ${configuredValue}`,
    );
  }

  // `origin` drops any trailing slash, path, or query so callers can join a
  // leading-slash path without producing a double slash.
  return parsedUrl.origin;
}
