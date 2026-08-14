// Configurable so e2e tests can point these at a local mock server.
// Set GOOGLE_TOKEN_URL / YOUTUBE_CHANNELS_URL in the environment to override.
const GOOGLE_TOKEN_URL =
  process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const YOUTUBE_CHANNELS_URL =
  process.env.YOUTUBE_CHANNELS_URL ??
  "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const GOOGLE_REVOKE_URL =
  process.env.GOOGLE_REVOKE_URL ?? "https://oauth2.googleapis.com/revoke";
// Revocation runs on the disconnect request path, so keep it short: the local
// row is already gone by the time this fires, and a hung provider must not
// stall the response.
const REVOCATION_TIMEOUT_MS = 5_000;

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export function buildYouTubeAuthUrl(
  redirectUri: string,
  state: string,
): string {
  const { googleClientId } = useRuntimeConfig();
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const { googleClientId, googleClientSecret } = useRuntimeConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  return res.json() as Promise<GoogleTokenResponse>;
}

// Revokes a Google OAuth grant at the provider so app access ends immediately
// on disconnect instead of lingering until the token expires. Revoking a
// refresh token also invalidates every access token minted from it, so callers
// should pass the refresh token when one is stored. Throws on a non-2xx
// response; the caller decides whether a revocation failure should block the
// local disconnect (it shouldn't).
export async function revokeGoogleToken(token: string): Promise<void> {
  const res = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(REVOCATION_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Google token revocation failed: ${res.status}`);
  }
}

export async function getYouTubeChannelHandle(
  accessToken: string,
): Promise<string> {
  const res = await fetch(YOUTUBE_CHANNELS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as {
    items?: { snippet?: { customUrl?: string; title?: string } }[];
  };
  const snippet = data.items?.[0]?.snippet;
  return snippet?.customUrl ?? snippet?.title ?? "";
}
