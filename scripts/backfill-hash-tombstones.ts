// One-off backfill: replaces any deletion_tombstones.provider_id still stored
// as a raw Clerk provider id (rows written before issue #215 hardened the
// storage) with sha256(provider_id + TOMBSTONE_ID_PEPPER). Safe to run
// repeatedly: already-hashed values are detected via isHashedProviderId and
// left untouched, so this never re-hashes a hash.
//
// Uses raw SQL rather than the Drizzle schema/query builder for the same reason
// as scripts/backfill-encrypt-tokens.ts: this script runs directly via `node`
// (Node's native TypeScript type-stripping), not through a bundler, and
// server/db/schema.ts's extensionless relative imports only resolve under
// Nitro/Vite — importing it here fails with ERR_MODULE_NOT_FOUND.
//
// Usage:
//   dotenvx run -f .env -- node scripts/backfill-hash-tombstones.ts
//   dotenvx run -f .env.production -- node scripts/backfill-hash-tombstones.ts
import { neon } from "@neondatabase/serverless";
import {
  hashProviderId,
  isHashedProviderId,
} from "../server/utils/tombstoneHash.ts";
import { isDirectInvocation } from "./isDirectInvocation.ts";

type TombstoneRow = {
  providerId: string;
};

// Structural type for neon's tagged-template SQL client — loose enough that
// tests can substitute a fake without needing a real Neon connection.
type SqlTag = (
  _strings: TemplateStringsArray,
  ..._values: unknown[]
) => Promise<unknown[]>;

function connectToDatabase(): SqlTag {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Run this script via `dotenvx run -f <env-file> -- node scripts/backfill-hash-tombstones.ts`.",
    );
  }

  return neon(databaseUrl) as unknown as SqlTag;
}

async function fetchTombstoneRows(sql: SqlTag): Promise<TombstoneRow[]> {
  const rows = await sql`
    SELECT provider_id AS "providerId"
    FROM deletion_tombstones
  `;
  return rows as TombstoneRow[];
}

type BackfillOutcome = "migrated" | "already-hashed" | "skipped-not-found";

// Moves a legacy raw row to its hashed form in one statement: delete the raw
// row, re-insert under the hash (preserving deleted_at), and if the hashed row
// already exists — the same account tombstoned again after #215 wrote the hash
// directly — ON CONFLICT DO NOTHING keeps it while the raw row is still purged.
// Either way the raw provider id is gone. RETURNING from the delete drives the
// outcome, so a concurrent backfill that already removed the raw row is a
// harmless no-op ("skipped-not-found").
export async function backfillRow(
  sql: SqlTag,
  row: TombstoneRow,
): Promise<BackfillOutcome> {
  if (isHashedProviderId(row.providerId)) {
    return "already-hashed";
  }

  const migratedRows = await sql`
    WITH deleted AS (
      DELETE FROM deletion_tombstones
      WHERE provider_id = ${row.providerId}
      RETURNING provider_id, deleted_at
    ),
    reinserted AS (
      INSERT INTO deletion_tombstones (provider_id, deleted_at)
      SELECT ${hashProviderId(row.providerId)}, deleted_at FROM deleted
      ON CONFLICT (provider_id) DO NOTHING
      RETURNING provider_id
    )
    SELECT provider_id FROM deleted
  `;

  return migratedRows.length > 0 ? "migrated" : "skipped-not-found";
}

// One row failing to hash or write must not abort the rest of the run (fail
// loud, but surface partial results) — the caller decides how to react to a
// non-zero failedCount rather than losing all progress to one bad row.
// Exported for unit testing.
export async function backfillRowReportingFailure(
  sql: SqlTag,
  row: TombstoneRow,
  rowIndex: number,
): Promise<BackfillOutcome | "failed"> {
  try {
    return await backfillRow(sql, row);
  } catch (error) {
    // Never log row.providerId: a legacy raw Clerk id is exactly the value this
    // change exists to stop retaining, so it must not leak into logs. The index
    // is enough to locate the row on a re-run.
    console.error(`tombstone row ${rowIndex} failed to backfill:`, error);
    return "failed";
  }
}

async function main(): Promise<void> {
  // Fail fast on a missing/short pepper before any DB work, so the operator
  // gets one clear TombstonePepperError instead of the same failure per row.
  hashProviderId("pepper-preflight-probe");

  const sql = connectToDatabase();
  const rows = await fetchTombstoneRows(sql);

  let migratedCount = 0;
  let skippedNotFoundCount = 0;
  let failedCount = 0;

  for (const [rowIndex, row] of rows.entries()) {
    const outcome = await backfillRowReportingFailure(sql, row, rowIndex);

    if (outcome === "migrated") {
      migratedCount += 1;
    }

    if (outcome === "skipped-not-found") {
      skippedNotFoundCount += 1;
    }

    if (outcome === "failed") {
      failedCount += 1;
    }
  }

  console.log(
    `Scanned ${rows.length} tombstone row(s); removed ${migratedCount} legacy raw provider id(s) (now retained only as a hash).` +
      (skippedNotFoundCount > 0
        ? ` Skipped ${skippedNotFoundCount} row(s) already removed concurrently — re-run to confirm.`
        : "") +
      (failedCount > 0
        ? ` ${failedCount} row(s) failed — see errors above; re-run to retry them.`
        : ""),
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

if (isDirectInvocation(import.meta.url)) {
  main().catch((error) => {
    console.error("backfill-hash-tombstones failed:", error);
    process.exit(1);
  });
}
