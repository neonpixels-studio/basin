// Isolates the deletion-tombstone table behind two small functions so the
// account-deletion sweep and getOrCreateUser can be unit-tested without a live
// database. A tombstone records the provider id (Clerk user id) of a deleted
// account so a still-valid session cannot resurrect an empty `users` row.
import { eq } from "drizzle-orm";
import { deletionTombstones } from "../db/schema";

// A tombstone only needs to outlive any session token that was minted just
// before the account was deleted: Clerk verifies JWTs networklessly, so such a
// token stays valid until it expires and until then could resurrect an empty
// `users` row. The maximum lifetime of such a token is the Clerk session
// lifetime, so once a tombstone is older than that window every pre-deletion
// token has already expired and the tombstone has served its purpose. Bounding
// retention to this window is what stops a failed deleteClerkUser from locking a
// still-live identity out forever: the lockout self-heals once the window
// passes. Keep this at or above the Clerk dashboard's session-lifetime setting
// (Clerk's default maximum is 7 days).
export const MAX_CLERK_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// Records that this provider id's account was deleted. Idempotent: deleting an
// already-tombstoned account is a no-op rather than a unique-violation error.
export async function recordDeletionTombstone(
  providerId: string,
): Promise<void> {
  await useDb()
    .insert(deletionTombstones)
    .values({ providerId })
    .onConflictDoNothing();
}

// True when this provider id belongs to a deleted account whose tombstone is
// still within the resurrection window, so getOrCreateUser must refuse to
// re-create the user instead of silently re-inserting a row. A tombstone older
// than the maximum Clerk session lifetime is ignored (see isTombstoneActive) so
// a failed Clerk deletion cannot lock a live identity out permanently.
export async function isProviderTombstoned(
  providerId: string,
): Promise<boolean> {
  const tombstone = await useDb().query.deletionTombstones.findFirst({
    where: eq(deletionTombstones.providerId, providerId),
  });
  if (!tombstone) {
    return false;
  }
  return isTombstoneActive(tombstone.deletedAt);
}

// A tombstone still blocks resurrection until the maximum Clerk session lifetime
// has elapsed since the deletion. A missing deletedAt fails closed (keep
// blocking): we cannot prove the window has passed, and a false negative here
// would resurrect a deleted account.
function isTombstoneActive(deletedAt: Date | null): boolean {
  if (!deletedAt) {
    // The column is NOT NULL, so this only fires on a malformed row. Fail loud
    // and closed: keep blocking (matching readClerkAuthContext's fail-closed
    // stance) but surface the impossible row so it can be reconciled rather than
    // silently locking an identity out.
    console.error(
      "deletion_tombstones row is missing deleted_at; blocking re-creation until reconciled",
    );
    return true;
  }
  const tombstoneAgeMs = Date.now() - deletedAt.getTime();
  return tombstoneAgeMs < MAX_CLERK_SESSION_LIFETIME_MS;
}
