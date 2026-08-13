import { and, eq } from "drizzle-orm";
import { integrations } from "../../db/schema";

interface StoredGrant {
  accessToken: string;
  refreshToken: string | null;
}

// Providers whose grants this endpoint knows how to revoke. Also the accept
// list for the route param: anything else is rejected up front, so an
// attacker-controlled provider string never reaches a query or a log line.
const REVOCABLE_PROVIDERS = ["youtube", "bluesky"] as const;
type RevocableProvider = (typeof REVOCABLE_PROVIDERS)[number];

function isRevocableProvider(value: string): value is RevocableProvider {
  return (REVOCABLE_PROVIDERS as readonly string[]).includes(value);
}

// Revokes the provider's stored grant so the user's disconnect actually ends
// the app's access, rather than leaving it live until the token expires. Each
// provider's remote call lives behind its own testable unit (revokeGoogleToken,
// deleteBlueskySession); this only decrypts and dispatches. Returns whether a
// remote revocation actually succeeded so the caller can report it honestly:
// false means nothing was revoked (no usable token stored).
async function revokeRemoteGrant(
  provider: RevocableProvider,
  grant: StoredGrant,
): Promise<boolean> {
  if (provider === "youtube") {
    // Revoking the refresh token also invalidates every access token minted
    // from it; fall back to the access token when no refresh token is stored.
    // `||` (not `??`) so an empty-string refresh token also falls back rather
    // than posting a blank token the provider would reject.
    const token =
      decryptNullableTokenTolerant(grant.refreshToken) ||
      decryptTokenTolerant(grant.accessToken);
    if (!token) {
      return false;
    }
    await revokeGoogleToken(token);
    return true;
  }

  // bluesky. App passwords can't be revoked via the app-password API, so tear
  // down the active session (refresh JWT) to invalidate the tokens we hold.
  const refreshJwt = decryptNullableTokenTolerant(grant.refreshToken);
  if (!refreshJwt) {
    return false;
  }
  await deleteBlueskySession(refreshJwt);
  return true;
}

// Best-effort: a revocation failure (provider down, token already invalid, or a
// rotated/unset encryption key that makes the stored token undecryptable) must
// never leave the user unable to disconnect, so we log and report false rather
// than throwing. The local row is deleted before this runs, so the disconnect
// itself never depends on the provider being reachable.
async function revokeRemoteGrantSafely(
  provider: RevocableProvider,
  grant: StoredGrant,
): Promise<boolean> {
  try {
    return await revokeRemoteGrant(provider, grant);
  } catch (error) {
    console.error(`Failed to revoke ${provider} grant on disconnect:`, error);
    return false;
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user)
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });

  const provider = getRouterParam(event, "provider");
  if (!provider)
    throw createError({
      statusCode: 400,
      statusMessage: "Provider is required",
    });

  if (!isRevocableProvider(provider))
    throw createError({
      statusCode: 400,
      statusMessage: "Unsupported provider",
    });

  // Delete-and-return in one atomic statement: the disconnect commits before we
  // attempt revocation, so it always succeeds even if the provider's revocation
  // endpoint hangs or fails, and there's no read-then-delete window. The
  // returned row still holds the tokens needed to revoke afterward.
  const [grant] = await useDb()
    .delete(integrations)
    .where(
      and(
        eq(integrations.userId, user.id),
        eq(integrations.provider, provider),
      ),
    )
    .returning({
      accessToken: integrations.accessToken,
      refreshToken: integrations.refreshToken,
    });

  const revoked = grant
    ? await revokeRemoteGrantSafely(provider, grant)
    : false;

  return { ok: true, revoked };
});
