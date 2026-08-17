import { deleteUserAccount } from "../../utils/accountDeletion";
import { assertRecentReverification } from "../../utils/reverification";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  // A valid bearer token isn't enough to erase an account: require the session
  // to have reverified a factor recently (Clerk `fva`). The client forces this
  // via useReverification, so a leaked/borrowed token alone can't get here.
  assertRecentReverification(event, "delete your account");

  await deleteUserAccount(event, user);

  return { ok: true };
});
