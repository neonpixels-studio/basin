import { integrations } from "../../../db/schema";
import { clearFeedSyncFailures } from "../../../utils/feedSyncStatus";
import { SYNC_STATUS } from "../../../utils/syncStatus";

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const { code, state } = getQuery(event);
  const cookieState = getCookie(event, "oauth_state_youtube");

  if (!code || !state || state !== cookieState) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid OAuth state",
    });
  }

  deleteCookie(event, "oauth_state_youtube");

  const redirectUri = buildYouTubeCallbackUrl();

  const tokens = await exchangeCodeForTokens(String(code), redirectUri);
  const handle = await getYouTubeChannelHandle(tokens.access_token);

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Encrypt once and reuse for both the insert and the conflict-update
  // branch below, rather than re-encrypting (and paying a fresh-IV cost)
  // twice for the same value.
  const encryptedAccessToken = encryptToken(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : null;

  const db = useDb();
  await db
    .insert(integrations)
    .values({
      userId: event.context.user.id,
      provider: "youtube",
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt,
      scopes: tokens.scope.split(" "),
      providerUsername: handle,
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        scopes: tokens.scope.split(" "),
        providerUsername: handle,
        // A successful (re)connect clears any stale "needs reconnect" state
        // immediately, rather than waiting for the next scheduled sync.
        syncStatus: SYNC_STATUS.OK,
        syncError: null,
        syncFailedAt: null,
        updatedAt: new Date(),
      },
    });

  // A working connection also clears any feed that previously failed
  // against it, instead of leaving "Needs attention" up until the next sync.
  await clearFeedSyncFailures(db, event.context.user.id, "youtube");

  return sendRedirect(event, "/settings/connections");
});
