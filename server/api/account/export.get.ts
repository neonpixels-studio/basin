import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { feedItems, feeds, integrations, userSettings } from "../../db/schema";
import {
  ACCOUNT_EXPORT_FILENAME,
  ACCOUNT_EXPORT_MIME_TYPE,
  buildAccountExport,
} from "../../utils/accountExport";

// A "saved item" is one the user starred or explicitly saved (savedAt set) —
// a superset of the "Saved" view, which narrows on savedAt alone
// (app/stores/feed.ts). Ownership is enforced with a subquery over the user's
// feeds rather than a materialized id list, so it holds regardless of how many
// sources the account has and closes the gap between the two reads.
async function fetchSavedItems(userId: number) {
  const db = useDb();
  return db.query.feedItems.findMany({
    where: and(
      inArray(
        feedItems.feedId,
        db.select({ id: feeds.id }).from(feeds).where(eq(feeds.userId, userId)),
      ),
      or(isNotNull(feedItems.savedAt), eq(feedItems.starred, true)),
    ),
    // id is a deterministic tiebreaker; publishedAt is nullable, so without it
    // the export order of null-published items is DB-defined (matches the
    // ordering in server/utils/feedItems.ts).
    orderBy: [
      sql`${feedItems.publishedAt} DESC NULLS LAST`,
      desc(feedItems.id),
    ],
  });
}

function fetchUserFeeds(userId: number) {
  return useDb().query.feeds.findMany({
    where: eq(feeds.userId, userId),
    orderBy: [desc(feeds.createdAt)],
  });
}

function fetchUserSettings(userId: number) {
  return useDb().query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
}

// Exclude token columns so integration secrets never leak into the export,
// matching server/api/integrations.get.ts.
function fetchUserIntegrations(userId: number) {
  return useDb().query.integrations.findMany({
    where: eq(integrations.userId, userId),
    columns: { accessToken: false, refreshToken: false, tokenSecret: false },
  });
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const [userFeeds, savedItems, settings, userIntegrations] = await Promise.all(
    [
      fetchUserFeeds(user.id),
      fetchSavedItems(user.id),
      fetchUserSettings(user.id),
      fetchUserIntegrations(user.id),
    ],
  );

  setHeader(
    event,
    "Content-Type",
    `${ACCOUNT_EXPORT_MIME_TYPE}; charset=utf-8`,
  );
  setHeader(
    event,
    "Content-Disposition",
    `attachment; filename="${ACCOUNT_EXPORT_FILENAME}"`,
  );

  return buildAccountExport({
    user,
    feeds: userFeeds,
    savedItems,
    settings: settings ?? null,
    integrations: userIntegrations,
    exportedAt: new Date(),
  });
});
