import { and, eq } from "drizzle-orm";
import { feeds } from "../../db/schema";
import { reactivateOldestPausedFeedsUnderCap } from "../../utils/feedPause";

// Reconciliation is a best-effort follow-up to a delete that already committed:
// a failure here must not turn a successful delete into a 500 (the client would
// retry and get a confusing 404). Log it loudly instead. Recovery is not
// automatic — the next delete's wider free-slot count repairs the promotion, so
// a source stays paused until the user deletes again; the log is the only signal
// in the meantime. It pairs a parseable JSON line (event + userId) with the raw
// error, since a reconcile failure is typically a DrizzleQueryError whose own
// message is the failed SQL and whose real cause sits on the error object.
async function reconcilePausedFeeds(userId: number): Promise<void> {
  try {
    const { reactivatedIds } =
      await reactivateOldestPausedFeedsUnderCap(userId);
    if (reactivatedIds.length === 0) {
      return;
    }
    console.log(
      JSON.stringify({
        event: "feed.deleted-reconciled",
        userId,
        count: reactivatedIds.length,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({ event: "feed.reconcile-failed", userId }),
      error,
    );
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user)
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });

  const id = Number(getRouterParam(event, "id"));
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "Invalid feed ID" });

  const deleted = await useDb()
    .delete(feeds)
    .where(and(eq(feeds.id, id), eq(feeds.userId, user.id)))
    .returning({ id: feeds.id });

  if (!deleted.length)
    throw createError({ statusCode: 404, statusMessage: "Feed not found" });

  // Deleting a source frees a slot: if this drops a downgraded account back
  // under the cap, promote the oldest paused sources into the freed slots so
  // the room is usable.
  await reconcilePausedFeeds(user.id);

  return { ok: true };
});
