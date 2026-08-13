// Orchestrates a full account deletion: stop billing, remove all stored data,
// then remove the identity. Kept in one place (rather than inline in the route)
// so the ordering and its rationale are testable in isolation.
import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { DbUser } from "./auth";
import { deleteClerkUser } from "./clerk";
import { deleteBillingRecords } from "./subscriptions";

// Order matters:
//   1. Delete the Stripe customer while the `subscriptions` row still exists —
//      deleting the user first would drop the id we need. This cancels any
//      active subscription and erases billing PII. If it throws, nothing has
//      been deleted yet and the caller surfaces a retryable error.
//   2. Delete the `users` row. Every user-owned table (feeds, feed_items via
//      feeds, integrations with their OAuth tokens, user_settings,
//      subscriptions) declares ON DELETE CASCADE on user_id, so this one
//      delete removes all associated data. If it throws, step 1 has already
//      irreversibly purged billing, so we log the half-deleted state loudly for
//      reconciliation before rethrowing — this is not a "nothing happened".
//   3. Delete the Clerk identity last, and treat its failure as non-fatal: by
//      this point the account data is already gone, so failing the request
//      would tell the user "nothing happened" while everything is irreversibly
//      deleted. We log the provider id for manual reconciliation instead and
//      let the caller report success so the client signs out.
//
// Known limitation: because the auth middleware runs getOrCreateUser on every
// authenticated request, a request that lands on a still-valid session (Clerk
// verifies JWTs networklessly, so a token minted just before deletion stays
// valid until it expires) can re-insert an *empty* users row for this
// provider_id. The user's data is still gone (that's the privacy promise); the
// resurrected row carries no personal data and, once the Clerk identity is
// removed, is unreachable. A provider-id tombstone honoured by getOrCreateUser
// would close this hygiene gap durably — tracked as a follow-up.
export async function deleteUserAccount(
  event: H3Event,
  user: DbUser,
): Promise<void> {
  await deleteBillingRecords(user.id);
  try {
    await useDb().delete(users).where(eq(users.id, user.id));
  } catch (caughtError) {
    console.error(
      `Stripe billing was purged for user ${user.id} but deleting the users row failed; the account is half-deleted and must be reconciled:`,
      caughtError,
    );
    throw caughtError;
  }
  try {
    await deleteClerkUser(event, user.providerId);
  } catch (caughtError) {
    console.error(
      `Account data deleted for user ${user.id}, but removing the Clerk identity ${user.providerId} failed; reconcile manually:`,
      caughtError,
    );
  }
}
