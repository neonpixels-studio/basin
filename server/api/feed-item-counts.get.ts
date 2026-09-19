import { fetchFeedItemCounts } from "../utils/feedItems";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  return fetchFeedItemCounts(user.id);
});
