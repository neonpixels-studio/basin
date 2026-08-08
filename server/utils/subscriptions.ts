// Owns reads/writes to the `subscriptions` table and translates Stripe
// subscription objects into our own plan/status representation. Keeps the
// Stripe SDK calls (server/utils/stripe.ts) separate from persistence.
import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import type Stripe from "stripe";
import { processedStripeEvents, subscriptions } from "../db/schema";
import { pauseFeedsOverFreeLimit, reactivateAllFeeds } from "./feedPause";
import { createStripeCustomer, deleteStripeCustomer } from "./stripe";

export type PlanName = "free" | "pro";

// Statuses that grant Pro access. Everything else (past_due, canceled,
// unpaid, incomplete, incomplete_expired, paused) falls back to "free".
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);

export function planForStatus(status: string): PlanName {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? "pro" : "free";
}

function logFeedPauseChange(
  userId: number,
  action: "paused" | "reactivated",
  count: number,
): void {
  if (count === 0) {
    return;
  }
  console.log(
    JSON.stringify({ event: `subscription.feeds-${action}`, userId, count }),
  );
}

// Applies the pricing page's source promise after a plan change is persisted,
// keyed off the *resulting* plan rather than the pro→free delta so it is
// self-healing: the persisted row is already updated by the time this runs, so
// on a Stripe retry a delta check would see free→free and skip the effect,
// permanently losing a pause whose first attempt failed. Deriving the action
// from the resulting plan instead means the retry re-runs the same idempotent
// effect. Free accounts pause every source beyond the cap; Pro accounts
// (unlimited) reactivate any paused source. Both are idempotent, so running
// them on every applied event — including free→free and pro→pro — is safe.
async function applyPlanChangeToFeeds(
  userId: number,
  plan: PlanName,
): Promise<void> {
  if (plan === "free") {
    const { pausedCount } = await pauseFeedsOverFreeLimit(userId);
    logFeedPauseChange(userId, "paused", pausedCount);
    return;
  }
  const { reactivatedCount } = await reactivateAllFeeds(userId);
  logFeedPauseChange(userId, "reactivated", reactivatedCount);
}

export interface AccountPlan {
  plan: PlanName;
  status: string;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export const FREE_PLAN: AccountPlan = {
  plan: "free",
  status: "none",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export async function getAccountPlan(userId: number): Promise<AccountPlan> {
  const db = useDb();
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  if (!subscription) {
    // Return a copy — FREE_PLAN is a shared module-level object and callers
    // must not be able to mutate it for other requests.
    return { ...FREE_PLAN };
  }

  return {
    plan: subscription.plan as PlanName,
    status: subscription.status,
    trialEnd: subscription.trialEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

export async function getOrCreateStripeCustomerId(
  userId: number,
  email: string | null,
): Promise<string> {
  const db = useDb();
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  if (existing) {
    return existing.stripeCustomerId;
  }

  // check-then-act is not atomic: two near-simultaneous first checkouts could
  // both reach here. onConflictDoNothing lets the loser's insert be ignored,
  // then we re-read so both requests return the winning customer ID (rather
  // than 500 on the unique constraint or return a mismatched customer).
  const customer = await createStripeCustomer({ email, userId });
  await db
    .insert(subscriptions)
    .values({ userId, stripeCustomerId: customer.id })
    .onConflictDoNothing({ target: subscriptions.userId });

  const persisted = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  const winningCustomerId = persisted?.stripeCustomerId ?? customer.id;

  // If we lost the race our freshly-created customer is now orphaned in Stripe
  // (no row references it); delete it so it can't accumulate a subscription.
  // This is best-effort cleanup: the caller already has a valid
  // winningCustomerId, so a transient Stripe failure here must not fail the
  // checkout the user is waiting on. Log it loudly instead of swallowing it
  // silently so the orphaned customer can be cleaned up manually.
  if (winningCustomerId !== customer.id) {
    await deleteStripeCustomer(customer.id).catch((cleanupError) => {
      console.error(
        `Failed to delete orphaned Stripe customer ${customer.id}:`,
        cleanupError,
      );
    });
  }
  return winningCustomerId;
}

function customerIdOf(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

function resolveUserIdFromMetadata(
  subscription: Stripe.Subscription,
): number | null {
  const metadataUserId = subscription.metadata?.userId;
  if (!metadataUserId) {
    return null;
  }
  const parsed = Number(metadataUserId);
  return Number.isInteger(parsed) ? parsed : null;
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

// Reads current_period_end from the subscription item (where it lives in the
// pinned API version) and falls back to the legacy top-level field so an older
// account default doesn't silently persist a null period end.
function currentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0];
  const legacyPeriodEnd = (
    subscription as unknown as { current_period_end?: number }
  ).current_period_end;
  return toDate(item?.current_period_end ?? legacyPeriodEnd);
}

interface ExistingSubscriptionRow {
  stripeSubscriptionId: string | null;
  plan: string;
  lastStripeEventAt: Date | null;
}

// An event is stale — and must not overwrite the stored row — if either:
//
// 1. It is strictly older than the last event already applied to this row
//    (regardless of subscription id — an old event redelivered within
//    Stripe's retry window must not resurrect state a newer one already
//    replaced, even for a subscription id the row has since moved past). A
//    tie (equal timestamps) is NOT stale: Stripe can fire distinct events
//    for the same subscription within the same one-second `created` value
//    (e.g. `updated` immediately followed by `deleted` on cancellation), and
//    rejecting ties would stick the row on the first of the pair forever.
//    Exact redelivery of the *same* event is a separate concern already
//    handled by wasEventAlreadyProcessed.
// 2. It is for a *different* subscription id than the row's, while the row
//    is still "pro". This is judged on subscription id, not timestamp: a
//    delayed event for a replaced subscription (e.g. a `deleted` for the old
//    one arriving weeks after a resubscribe) can have a *later* `created`
//    than the new subscription's own events, so timestamp alone can't tell
//    them apart. Once the row is no longer "pro", a different id is a
//    genuine resubscribe and is let through.
//
// This is only a cheap in-memory pre-filter — the authoritative, race-safe
// guarantee is the `setWhere` clause on the write below, which mirrors this
// same logic atomically against the row's actual current state in Postgres.
function isStaleEvent(
  existing: ExistingSubscriptionRow | undefined,
  subscription: Stripe.Subscription,
  eventCreatedAt: Date,
): boolean {
  if (!existing?.stripeSubscriptionId) {
    return false;
  }
  if (
    existing.lastStripeEventAt &&
    eventCreatedAt < existing.lastStripeEventAt
  ) {
    return true;
  }
  return (
    existing.stripeSubscriptionId !== subscription.id && existing.plan === "pro"
  );
}

// Mirrors isStaleEvent as a SQL condition, passed as the write's setWhere so
// Postgres makes the same decision atomically against the row's actual
// current state (see isStaleEvent's comment for why each branch exists).
function notStaleWhereClause(
  subscription: Stripe.Subscription,
  eventCreatedAt: Date,
) {
  const notOlderThanLastApplied = or(
    isNull(subscriptions.lastStripeEventAt),
    lte(subscriptions.lastStripeEventAt, eventCreatedAt),
  );
  const sameSubscriptionOrNoLongerPro = or(
    eq(subscriptions.stripeSubscriptionId, subscription.id),
    ne(subscriptions.plan, "pro"),
  );
  return or(
    isNull(subscriptions.stripeSubscriptionId),
    and(notOlderThanLastApplied, sameSubscriptionOrNoLongerPro),
  );
}

async function wasEventAlreadyProcessed(
  db: ReturnType<typeof useDb>,
  stripeEventId: string,
): Promise<boolean> {
  const processedEvent = await db.query.processedStripeEvents.findFirst({
    where: eq(processedStripeEvents.stripeEventId, stripeEventId),
  });
  return Boolean(processedEvent);
}

// Records that an event was applied, so a redelivery of the same event id is
// a no-op instead of being reapplied. Always called *after* the subscription
// write below has succeeded, never before, so a crash between the two can
// only leave an event applied-but-unmarked (safe — a redelivery just
// reapplies the same, idempotent write), never marked-but-unapplied (which
// would silently drop a real update forever).
async function markEventProcessed(
  db: ReturnType<typeof useDb>,
  stripeEventId: string,
  eventType: string,
): Promise<void> {
  await db
    .insert(processedStripeEvents)
    .values({ stripeEventId, eventType })
    .onConflictDoNothing({ target: processedStripeEvents.stripeEventId });
}

// Called from the Stripe webhook for customer.subscription.created/updated/deleted.
// Matches the event to a user via the stored Stripe customer ID (set when the
// checkout session's customer was created), falling back to the userId we embed
// in the subscription metadata at checkout time. If neither resolves, the event
// can't be attributed to a known user and is dropped.
//
// Duplicate delivery is handled by wasEventAlreadyProcessed; out-of-order
// delivery by isStaleEvent (see both functions' comments).
export async function upsertSubscriptionFromStripe(
  event: Stripe.Event,
): Promise<void> {
  const db = useDb();

  if (await wasEventAlreadyProcessed(db, event.id)) {
    return;
  }

  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = customerIdOf(subscription);

  const existingByCustomer = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, stripeCustomerId),
  });

  const userId =
    existingByCustomer?.userId ?? resolveUserIdFromMetadata(subscription);
  if (!userId) {
    return;
  }

  // Resolve the row we write to by userId (the stable owner key) so the
  // metadata-fallback path updates an existing row rather than colliding on
  // the user_id unique constraint.
  const existing =
    existingByCustomer ??
    (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    }));

  const eventCreatedAt = new Date(event.created * 1000);
  if (isStaleEvent(existing, subscription, eventCreatedAt)) {
    return;
  }

  const item = subscription.items?.data?.[0];
  const values = {
    userId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: item?.price.id ?? null,
    plan: planForStatus(subscription.status),
    status: subscription.status,
    currentPeriodEnd: currentPeriodEnd(subscription),
    trialEnd: toDate(subscription.trial_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    lastStripeEventAt: eventCreatedAt,
    updatedAt: new Date(),
  };

  // isStaleEvent above is only a pre-filter — two racing deliveries could
  // both read the row before either writes. notStaleWhereClause makes the
  // guarantee atomic by re-checking the same logic against the row's actual
  // current state inside the write itself.
  const written = await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: values,
      setWhere: notStaleWhereClause(subscription, eventCreatedAt),
    })
    .returning({ id: subscriptions.id });

  // `returning` comes back empty when setWhere blocked the update (the DB
  // decided the event was stale after all) — that event was correctly not
  // applied, so it's left unmarked in processedStripeEvents, same as the
  // no-known-userId branch above.
  if (written.length === 0) {
    return;
  }

  // Runs before markEventProcessed so a failure here leaves the event unmarked
  // and Stripe's retry re-runs the (idempotent) effect — see
  // applyPlanChangeToFeeds for why this is keyed off the resulting plan.
  await applyPlanChangeToFeeds(userId, values.plan);

  // Only recorded once the write above has actually succeeded — see
  // markEventProcessed's comment for why this ordering matters.
  await markEventProcessed(db, event.id, event.type);
}
