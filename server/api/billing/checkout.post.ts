import {
  createCheckoutSession,
  type BillingInterval,
} from "../../utils/stripe";
import { getConfiguredSiteUrl } from "../../utils/siteUrl";
import { getOrCreateStripeCustomerId } from "../../utils/subscriptions";

const VALID_INTERVALS = new Set<BillingInterval>(["month", "year"]);

interface CheckoutRequestBody {
  interval?: string;
}

function isValidInterval(value: unknown): value is BillingInterval {
  return (
    typeof value === "string" && VALID_INTERVALS.has(value as BillingInterval)
  );
}

export default defineEventHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const body = await readBody<CheckoutRequestBody>(event);
  if (!body || !isValidInterval(body.interval)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid billing interval: must be "month" or "year"',
    });
  }

  // Email is intentionally not taken from the client (it would be spoofable and
  // attach billing mail to an arbitrary address). Stripe Checkout collects and
  // verifies the customer's email during the session instead.
  const customerId = await getOrCreateStripeCustomerId(user.id, null);

  const baseUrl = getConfiguredSiteUrl();
  const session = await createCheckoutSession({
    customerId,
    interval: body.interval,
    userId: user.id,
    successUrl: `${baseUrl}/settings/account?checkout=success`,
    cancelUrl: `${baseUrl}/pricing?checkout=cancelled`,
  });

  if (!session.url) {
    throw createError({
      statusCode: 502,
      statusMessage: "Stripe did not return a checkout URL",
    });
  }

  return { url: session.url };
});
