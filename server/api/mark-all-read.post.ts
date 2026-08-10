import {
  markAllItemsRead,
  VALID_MARK_ALL_READ_FILTERS,
} from "../utils/markAllRead";

// Absent means "all"; a present filter must be a recognized dashboard filter id
// so a typo or a never-added mapping fails loudly instead of marking nothing.
function parseFilter(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw === "string" && VALID_MARK_ALL_READ_FILTERS.has(raw)) {
    return raw;
  }
  throw createError({
    statusCode: 400,
    statusMessage: `Unknown mark-all-read filter: ${String(raw)}`,
  });
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const body = await readBody<{ filter?: unknown }>(event);
  const filter = parseFilter(body?.filter);

  await markAllItemsRead(user.id, { filter });
  return { ok: true };
});
