// Derives the value stored in the deletion_tombstones table from a Clerk
// provider id. We keep sha256(provider_id + server pepper) rather than the raw
// provider id so the retained row is a one-way equality token, not a
// re-linkable pseudonymous identifier (issue #215). A tombstone only ever needs
// equality ("is this provider id tombstoned?"), which a hash preserves.
//
// Isolated in its own module so the peppered hash can be unit-tested without a
// database, mirroring server/utils/crypto.ts's separation of a secret-keyed
// primitive from its call sites.
import { createHash } from "node:crypto";

const HASH_ALGORITHM = "sha256";
const HASH_OUTPUT_ENCODING = "hex";

// A sha256 hex digest is always 64 hex characters. A raw Clerk provider id
// ("user_...") never matches this, so the shape doubles as a detector for
// legacy rows written before hashing existed.
const HASHED_PROVIDER_ID_PATTERN = /^[0-9a-f]{64}$/i;

// A pepper shorter than this is almost certainly a placeholder or a typo rather
// than a real secret; fail loud instead of silently weakening the hash.
const MIN_PEPPER_LENGTH_CHARS = 16;

export class TombstonePepperError extends Error {}

function getTombstonePepper(): string {
  const pepper = process.env.TOMBSTONE_ID_PEPPER;

  if (!pepper || pepper.length < MIN_PEPPER_LENGTH_CHARS) {
    throw new TombstonePepperError(
      `TOMBSTONE_ID_PEPPER must be set to at least ${MIN_PEPPER_LENGTH_CHARS} ` +
        "characters. Generate one with `openssl rand -hex 32` and add it to " +
        "your environment.",
    );
  }

  return pepper;
}

// Peppered so an attacker who exfiltrates the tombstone table still cannot
// confirm a guessed provider id by hashing it without also holding the pepper.
export function hashProviderId(providerId: string): string {
  const pepper = getTombstonePepper();

  return createHash(HASH_ALGORITHM)
    .update(providerId + pepper)
    .digest(HASH_OUTPUT_ENCODING);
}

// True when a stored tombstone value is already a hash rather than a legacy raw
// provider id. Used by the backfill to stay idempotent and by the tolerant
// lookup to reason about not-yet-migrated rows.
export function isHashedProviderId(value: string): boolean {
  return HASHED_PROVIDER_ID_PATTERN.test(value);
}
