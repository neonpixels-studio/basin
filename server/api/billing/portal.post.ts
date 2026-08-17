import type Stripe from "stripe";
import { createBillingPortalSession } from "../../utils/stripe";
import { getStripeCustomerId } from "../../utils/subscriptions";

async function createPortalSessionOrThrow(
  customerId: string,
  origin: string,
  userId: number,
): Promise<Stripe.BillingPortal.Session> {
  try {
    return await createBillingPortalSession({
      customerId,
      returnUrl: `${origin}/settings/account`,
    });
  } catch (caughtError) {
    console.error(
      `Stripe billing portal failed for user ${userId}:`,
      caughtError,
    );
    throw createError({
      statusCode: 502,
      statusMessage: "Could not open the billing portal",
    });
  }
}

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
  // The portal call throws on known-reachable states (an unconfigured portal in
  // the Stripe dashboard, or a customer that no longer exists in Stripe). Map
  // those to a 502 with a generic message rather than leaking Stripe's raw
  // error text out of an unhandled 500.
  const session = await createPortalSessionOrThrow(customerId, origin, user.id);

  if (!session.url) {
    throw createError({
      statusCode: 502,
      statusMessage: "Stripe did not return a billing portal URL",
    });
  }

  return { url: session.url };
});
