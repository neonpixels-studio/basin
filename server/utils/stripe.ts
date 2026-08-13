// Isolates all direct Stripe SDK calls behind small, mockable functions so
// route handlers never touch the `stripe` package directly. See tests/server/utils/stripe.test.ts
// for the mocked-SDK unit tests.
import Stripe from "stripe";

export type BillingInterval = "month" | "year";

const TRIAL_PERIOD_DAYS = 14;

// Pin the API version so the webhook payload shape matches the types shipped
// with this `stripe` package version. Without pinning, Stripe sends each
// account's default version and fields can move between versions (e.g.
// current_period_end moved onto the subscription item), silently breaking
// parsing on accounts with an older default.
const STRIPE_API_VERSION = "2026-06-24.dahlia";

function getStripeSecretKey(): string {
  const { stripeSecretKey } = useRuntimeConfig();
  if (!stripeSecretKey) {
    throw createError({
      statusCode: 500,
      statusMessage: "Stripe is not configured: missing NUXT_STRIPE_SECRET_KEY",
    });
  }
  return stripeSecretKey;
}

export function getStripeClient(): Stripe {
  return new Stripe(getStripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
}

export function priceIdForInterval(interval: BillingInterval): string {
  const { stripePriceProMonthly, stripePriceProYearly } = useRuntimeConfig();
  const priceId =
    interval === "year" ? stripePriceProYearly : stripePriceProMonthly;
  if (!priceId) {
    throw createError({
      statusCode: 500,
      statusMessage: `Stripe is not configured: missing price ID for the ${interval}ly Pro plan`,
    });
  }
  return priceId;
}

export interface CreateCheckoutSessionParams {
  customerId: string;
  interval: BillingInterval;
  userId: number;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: params.customerId,
    client_reference_id: String(params.userId),
    line_items: [{ price: priceIdForInterval(params.interval), quantity: 1 }],
    // "if_required" honours the pricing page's "No card to start" promise:
    // Stripe skips card entry for the trial. If the trial ends without a
    // payment method, the subscription is cancelled rather than charged.
    payment_method_collection: "if_required",
    subscription_data: {
      trial_period_days: TRIAL_PERIOD_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      metadata: { userId: String(params.userId) },
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

export interface CreateStripeCustomerParams {
  email: string | null;
  userId: number;
}

export async function createStripeCustomer(
  params: CreateStripeCustomerParams,
): Promise<Stripe.Customer> {
  const stripe = getStripeClient();
  return stripe.customers.create({
    email: params.email ?? undefined,
    metadata: { userId: String(params.userId) },
  });
}

export async function deleteStripeCustomer(customerId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.customers.del(customerId);
}

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
): Stripe.Event {
  const { stripeWebhookSecret } = useRuntimeConfig();
  if (!stripeWebhookSecret) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Stripe is not configured: missing NUXT_STRIPE_WEBHOOK_SECRET",
    });
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    stripeWebhookSecret,
  );
}
