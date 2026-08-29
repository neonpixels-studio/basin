-- Hand-edited: drizzle-kit generates a bare SET DATA TYPE, which reinterprets
-- each existing naive value in the *migration* session's TimeZone — correct only
-- if that session happens to match the sessions that wrote the rows. These rows
-- were written by defaultNow() on Neon, whose session TimeZone is UTC, so pin the
-- interpretation to UTC explicitly. This recovers the original instant regardless
-- of the migration session's TimeZone, rather than inheriting it.
ALTER TABLE "deletion_tombstones" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp with time zone USING "deleted_at" AT TIME ZONE 'UTC';
