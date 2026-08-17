// Orchestrates a full account deletion: stop billing, remove all stored data,
// then remove the identity. Kept in one place (rather than inline in the route)
// so the ordering and its rationale are testable in isolation.
import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { DbUser } from "./auth";
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
export async function deleteUserAccount(
  event: H3Event,
  user: DbUser,
): Promise<void> {
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
  try {
    await deleteClerkUser(event, user.providerId);
  } catch (caughtError) {
    // The identity is now tombstoned, so this provider id is 403'd from
    // re-creating a user. If reconciliation keeps the Clerk identity alive,
    // the deletion_tombstones row for it must be removed too, or the account
    // stays permanently locked out.
    console.error(
      `Account data deleted for user ${user.id}, but removing the Clerk identity ${user.providerId} failed; reconcile manually (also delete its deletion_tombstones row if the identity is kept):`,
      caughtError,
    );
  }
}
