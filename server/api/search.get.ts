import { searchFeedItems } from "../utils/search";

// Module scope (not nested in the handler) so it isn't re-created on every
// request and can be unit tested on its own, matching clampSearchLimit/
// resolveSearchOffset in search.ts.
function parseIntOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  // A very long digit string parses past Number.MAX_SAFE_INTEGER (and past
  // Postgres bigint), which would 500 the query. Drop it instead so the
  // request falls back to the default page rather than erroring.
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user)
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });

  const rawQuery = getQuery(event);
  const query = typeof rawQuery.q === "string" ? rawQuery.q.trim() : "";
  if (!query)
    throw createError({ statusCode: 400, statusMessage: "Query is required" });

  const limit = parseIntOrUndefined(rawQuery.limit);
  const offset = parseIntOrUndefined(rawQuery.offset);

  return searchFeedItems(user.id, query, { limit, offset });
});
