// Orchestrates a full account deletion: stop billing, remove all stored data,
// then remove the identity. Kept in one place (rather than inline in the route)
// so the ordering and its rationale are testable in isolation.
import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { DbUser } from "./auth";
import { findUserByProviderId } from "./auth";
import { deleteClerkUser } from "./clerk";
import { deleteBillingRecords } from "./subscriptions";
import { recordDeletionTombstone } from "./tombstone";

// Order matters:
//   1. Delete the Stripe customer while the `subscriptions` row still exists —
//      deleting the user first would drop the id we need. This cancels any
//      active subscription and erases billing PII. If it throws, nothing has
//      been deleted yet and the caller surfaces a retryable error.
//   2. Record a deletion tombstone for the provider id, then delete the
//      `users` row. The tombstone is written *first*: because getOrCreateUser
//      honours it (server/utils/auth.ts), a still-valid session (Clerk verifies
//      JWTs networklessly, so a token minted just before deletion stays valid
//      until it expires) cannot re-insert an empty row once the tombstone
//      exists. Writing it before the delete leaves no resurrection window — the
//      users row still satisfies getOrCreateUser until it is gone, by which
//      point the tombstone already blocks re-creation. The neon-http driver has
//      no interactive transactions, but this ordering is safe under partial
//      failure regardless: a tombstone with the row still present just returns
//      the existing user, and the delete is retryable. Every user-owned table
//      (feeds, feed_items via feeds, integrations with their OAuth tokens,
//      user_settings, subscriptions) declares ON DELETE CASCADE on user_id, so
//      this one delete removes all associated data. If either write throws,
//      step 1 has already irreversibly purged billing, so we log the
//      half-deleted state loudly for reconciliation before rethrowing — this is
//      not a "nothing happened".
//   3. Delete the Clerk identity last, and treat its failure as non-fatal: by
//      this point the account data is already gone, so failing the request
//      would tell the user "nothing happened" while everything is irreversibly
//      deleted. We log the provider id for manual reconciliation instead and
//      let the caller report success so the client signs out.
// Purges all stored account data for a user: billing first, then a
// resurrection-proof tombstone, then the users row whose ON DELETE CASCADE
// removes everything else (feeds, feed_items, integrations, user_settings,
// subscriptions). Shared by the in-app deletion route (which then also removes
// the Clerk identity) and the Clerk user.deleted webhook (where the identity is
// already gone), so the ordering and its partial-failure handling live in one
// place. See deleteUserAccount's step-by-step comment above for why the order
// matters and why each step is retryable.
async function purgeAccountData(user: DbUser): Promise<void> {
  await deleteBillingRecords(user.id);
  // Split from the delete below so a reconciler can tell which write failed —
  // the single fact they need is whether the users row still exists. Both steps
  // are retryable: a tombstone with the row still present just returns the
  // existing user from getOrCreateUser.
  try {
    await recordDeletionTombstone(user.providerId);
  } catch (caughtError) {
    console.error(
      `Stripe billing was purged for user ${user.id} but recording the deletion tombstone failed; the users row is still intact and this is retryable:`,
      caughtError,
    );
    throw caughtError;
  }
  try {
    await useDb().delete(users).where(eq(users.id, user.id));
  } catch (caughtError) {
    console.error(
      `Stripe billing was purged and the deletion tombstone written for user ${user.id}, but deleting the users row failed; the users row is still present and must be reconciled (retry is safe):`,
      caughtError,
    );
    throw caughtError;
  }
}

export async function deleteUserAccount(
  event: H3Event,
  user: DbUser,
): Promise<void> {
  await purgeAccountData(user);
  try {
    await deleteClerkUser(event, user.providerId);
  } catch (caughtError) {
    // The identity is now tombstoned, so this provider id is 403'd from
    // re-creating a user. The lockout is bounded: isProviderTombstoned ignores
    // tombstones older than the maximum Clerk session lifetime, so a kept
    // identity self-heals once that window passes. Reconcile before then (delete
    // the deletion_tombstones row) if the identity must stay usable sooner.
    console.error(
      `Account data deleted for user ${user.id}, but removing the Clerk identity ${user.providerId} failed; reconcile manually (delete its deletion_tombstones row if the identity is kept, else it stays locked out until the session-lifetime window elapses):`,
      caughtError,
    );
  }
}

// Handles Clerk's `user.deleted` webhook: the identity is already gone on
// Clerk's side, so we only purge our stored data and never call deleteClerkUser
// (unlike the in-app deleteUserAccount above). Resolves the app user by the
// Clerk provider id, then purges. When no row matches there is nothing to purge,
// but we still record the tombstone: a session token minted just before the
// deletion stays valid (Clerk verifies JWTs networklessly), so without it the
// auth middleware could resurrect an empty users row on that token's next
// request. Idempotent — Clerk retries webhooks, and re-running on an
// already-deleted account is a no-op (findUserByProviderId returns undefined,
// recordDeletionTombstone is onConflictDoNothing).
export async function deleteAccountByProviderId(
  providerId: string,
): Promise<void> {
  const user = await findUserByProviderId(providerId);
  if (!user) {
    await recordDeletionTombstone(providerId);
    return;
  }
  await purgeAccountData(user);
}
