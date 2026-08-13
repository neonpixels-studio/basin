import { deleteUserAccount } from "../../utils/accountDeletion";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  await deleteUserAccount(event, user);

  return { ok: true };
});
