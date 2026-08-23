// Isolates the deletion-tombstone table behind two small functions so the
// account-deletion sweep and getOrCreateUser can be unit-tested without a live
// database. A tombstone records a one-way hash of the provider id (Clerk user
// id) of a deleted account so a still-valid session cannot resurrect an empty
// `users` row. The raw provider id is never stored — see server/utils/
// tombstoneHash.ts for why (issue #215).
import { inArray } from "drizzle-orm";
import { deletionTombstones } from "../db/schema";
import { hashProviderId } from "./tombstoneHash";

// Records that this provider id's account was deleted, storing only the
// peppered hash. Idempotent: deleting an already-tombstoned account is a no-op
// rather than a unique-violation error.
export async function recordDeletionTombstone(
  providerId: string,
): Promise<void> {
  // Hash first so a missing pepper throws before any DB write — the deletion
  // sweep must never delete account data and then fail to record the tombstone.
  const providerIdHash = hashProviderId(providerId);
  await useDb()
    .insert(deletionTombstones)
    .values({ providerId: providerIdHash })
    .onConflictDoNothing();
}

// True when this provider id belongs to a deleted account, so getOrCreateUser
// must refuse to re-create the user instead of silently re-inserting a row.
// Matches either the peppered hash (rows written since #215) or the raw
// provider id (legacy rows not yet migrated by
// scripts/backfill-hash-tombstones.ts), so hardening the stored value never
// reopens the resurrection gap for an already-deleted account.
export async function isProviderTombstoned(
  providerId: string,
): Promise<boolean> {
  const tombstone = await useDb().query.deletionTombstones.findFirst({
    where: inArray(deletionTombstones.providerId, [
      hashProviderId(providerId),
      // @todo Drop the raw-id arm once every environment has run
      // scripts/backfill-hash-tombstones.ts, so no legacy raw rows remain.
      providerId,
    ]),
  });
  return Boolean(tombstone);
}
