// Configurable so e2e tests can point this at a local mock server.
// Set BLUESKY_SESSION_URL in the environment to override.
const BLUESKY_SESSION_URL =
  process.env.BLUESKY_SESSION_URL ??
  "https://bsky.social/xrpc/com.atproto.server.createSession";
const BLUESKY_DELETE_SESSION_URL =
  process.env.BLUESKY_DELETE_SESSION_URL ??
  "https://bsky.social/xrpc/com.atproto.server.deleteSession";
// Session teardown runs on the disconnect request path, so keep it short: the
// local row is already gone by the time this fires, and a hung provider must
// not stall the response.
const SESSION_TEARDOWN_TIMEOUT_MS = 5_000;

export interface BlueskySession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

export async function createBlueskySession(
  identifier: string,
  appPassword: string,
): Promise<BlueskySession> {
  const response = await fetch(BLUESKY_SESSION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password: appPassword }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Bluesky authentication failed: ${response.status}`);
  }

  return response.json() as Promise<BlueskySession>;
}

// Tears down the stored Bluesky session on disconnect so the access/refresh
// JWTs we hold stop working immediately. deleteSession authenticates with the
// refresh JWT (Bearer). App passwords themselves can't be revoked through the
// app-password API, so invalidating the session is the appropriate teardown.
// Throws on a non-2xx response; the caller decides whether a teardown failure
// should block the local disconnect (it shouldn't).
export async function deleteBlueskySession(refreshJwt: string): Promise<void> {
  const response = await fetch(BLUESKY_DELETE_SESSION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshJwt}` },
    signal: AbortSignal.timeout(SESSION_TEARDOWN_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Bluesky session teardown failed: ${response.status}`);
  }
}
