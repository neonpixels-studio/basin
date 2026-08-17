// Isolates the deletion-tombstone table behind two small functions so the
// account-deletion sweep and getOrCreateUser can be unit-tested without a live
// database. A tombstone records the provider id (Clerk user id) of a deleted
// account so a still-valid session cannot resurrect an empty `users` row.
import { eq } from "drizzle-orm";
import { deletionTombstones } from "../db/schema";

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

// True when this provider id belongs to a deleted account, so getOrCreateUser
// must refuse to re-create the user instead of silently re-inserting a row.
export async function isProviderTombstoned(
  providerId: string,
): Promise<boolean> {
  const tombstone = await useDb().query.deletionTombstones.findFirst({
    where: eq(deletionTombstones.providerId, providerId),
  });
  return Boolean(tombstone);
}
