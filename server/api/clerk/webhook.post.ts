import { verifyClerkWebhook } from "../../utils/clerk";
import { deleteAccountByProviderId } from "../../utils/accountDeletion";

// Clerk fires many event types; we only act on account deletion so a user
// deleting their Clerk account cascades cleanup into our database (feeds,
// feed_items, integrations with their OAuth tokens, user_settings,
// subscriptions), closing the retention gap left by verifying auth only.
const USER_DELETED_EVENT = "user.deleted" as const;

export default defineEventHandler(async (event) => {
  let webhookEvent;
  try {
    webhookEvent = await verifyClerkWebhook(event);
  } catch (caughtError) {
    // A missing signing secret surfaces as a 500 from verifyClerkWebhook: that's
    // a server misconfiguration, not a bad signature, so let it propagate as a
    // 5xx (Clerk retries) instead of masking it as a permanent 400 Clerk won't
    // retry. Only an actual verification failure should be reported as a 400.
    if (isError(caughtError) && caughtError.statusCode >= 500) {
      throw caughtError;
    }
    // Never trust an unverified payload: reject rather than parse it.
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid Clerk webhook signature",
    });
  }

  if (webhookEvent.type !== USER_DELETED_EVENT) {
    return { received: true };
  }

  const providerId = webhookEvent.data.id;
  if (!providerId) {
    // A delete event with no user id can't be attributed to an account; ack it
    // so Clerk doesn't retry a payload we can never act on.
    return { received: true };
  }

  await deleteAccountByProviderId(providerId);
  return { received: true };
});
