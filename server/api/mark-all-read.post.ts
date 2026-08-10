import {
  markAllItemsRead,
  VALID_MARK_ALL_READ_FILTERS,
} from "../utils/markAllRead";

// An absent key means "all"; any present value (including null) must be a
// recognized dashboard filter id, so a typo, a null, or a never-added mapping
// fails loudly with a 400 instead of silently widening to an irreversible
// account-wide update or marking nothing.
function parseFilter(raw: unknown): string | undefined {
  if (raw === undefined) {
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
