import { integrations } from "../../db/schema";
import { createBlueskyFeedForUser } from "../../utils/integrationFeedCreation";
import { clearFeedSyncFailures } from "../../utils/feedSyncStatus";
import { SYNC_STATUS } from "../../utils/syncStatus";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const body = await readBody(event);
  const handle = body?.handle?.trim();
  const appPassword = body?.appPassword?.trim();

  if (!handle || !appPassword) {
    throw createError({
      statusCode: 400,
      statusMessage: "Handle and app password are required",
    });
  }

  let session;
  try {
    session = await createBlueskySession(handle, appPassword);
  } catch {
    throw createError({
      statusCode: 401,
      statusMessage: "Invalid Bluesky handle or app password",
    });
  }

  // Encrypt once and reuse for both the insert and the conflict-update
  // branch below, rather than re-encrypting (and paying a fresh-IV cost)
  // twice for the same value. The app password is the most sensitive value
  // here — it's still needed in tokenSecret for the sync worker's fallback
  // re-auth (see comment below), so it must be encrypted like the tokens.
  const encryptedAccessToken = encryptToken(session.accessJwt);
  const encryptedRefreshToken = encryptToken(session.refreshJwt);
  const encryptedAppPassword = encryptToken(appPassword);

  const db = useDb();
  await db
    .insert(integrations)
    .values({
      userId: user.id,
      provider: "bluesky",
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      // App password stored in tokenSecret so the sync worker can re-authenticate
      // when both the access and refresh JWTs have expired.
      tokenSecret: encryptedAppPassword,
      providerAccountId: session.did,
      providerUsername: session.handle,
    })
    .onConflictDoUpdate({
      target: [integrations.userId, integrations.provider],
      set: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenSecret: encryptedAppPassword,
        providerAccountId: session.did,
        providerUsername: session.handle,
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
  await clearFeedSyncFailures(db, user.id, "bluesky");

  // Without this, a connected Bluesky account is a dead end: the sync engine
  // (netlify/functions/sync-feed.ts) only ever acts on feeds rows, and
  // nothing above this line ever created one. A failure here (the Free-plan
  // cap already reached) must not undo an already-verified, already-saved
  // connection, so it's logged rather than thrown.
  try {
    await createBlueskyFeedForUser(db, user.id, session.handle);
  } catch (error) {
    console.error("Failed to create Bluesky feed for user:", error);
  }

  return { ok: true, handle: session.handle };
});
