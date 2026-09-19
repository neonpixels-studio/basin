import { fetchFeedItems } from "../utils/feedItems";
import { ALL_FILTER, VALID_FEED_FILTERS } from "../utils/feedFilters";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const query = getQuery(event);

  function parseIntOrUndefined(value: unknown): number | undefined {
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      return undefined;
    }
    return Number.parseInt(value, 10);
  }

  // An absent or "all" filter means no restriction; any other value must be a
  // known dashboard filter id, so a typo fails loudly with a 400 rather than
  // silently returning an empty (or unfiltered) list.
  function parseFilter(value: unknown): string | undefined {
    if (value === undefined || value === ALL_FILTER) {
      return undefined;
    }
    if (typeof value === "string" && VALID_FEED_FILTERS.has(value)) {
      return value;
    }
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown feed filter: ${String(value)}`,
    });
  }

  const limit = parseIntOrUndefined(query.limit);
  const offset = parseIntOrUndefined(query.offset);
  const filter = parseFilter(query.filter);

  return fetchFeedItems(user.id, { limit, offset, filter });
});
