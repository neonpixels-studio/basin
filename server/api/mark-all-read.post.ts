import { markAllItemsRead } from "../utils/markAllRead";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const body = await readBody<{ filter?: unknown }>(event);
  const filter = typeof body?.filter === "string" ? body.filter : undefined;

  const marked = await markAllItemsRead(user.id, { filter });
  return { ok: true, marked };
});
