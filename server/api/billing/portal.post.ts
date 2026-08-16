import { createBillingPortalSession } from "../../utils/stripe";
import { getStripeCustomerId } from "../../utils/subscriptions";

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  // Resolve the customer from the authenticated user's own subscription row so
  // the portal is always scoped to their billing, never a client-supplied id.
  const customerId = await getStripeCustomerId(user.id);
  if (!customerId) {
    throw createError({
      statusCode: 404,
      statusMessage: "No billing account to manage",
    });
  }

  const { origin } = getRequestURL(event);
  const session = await createBillingPortalSession({
    customerId,
    returnUrl: `${origin}/settings/account`,
  });

  if (!session.url) {
    throw createError({
      statusCode: 502,
      statusMessage: "Stripe did not return a billing portal URL",
    });
  }

  return { url: session.url };
});
