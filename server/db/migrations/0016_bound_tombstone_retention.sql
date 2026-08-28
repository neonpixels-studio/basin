-- Hand-edited: drizzle-kit generates a bare SET DATA TYPE, which reinterprets
-- each existing naive value in the migration session's TimeZone. The values were
-- written by defaultNow() (now() truncated to the DB session's TimeZone), so
-- reverse that exact conversion with current_setting('TimeZone') to preserve the
-- original instant on any deployment rather than assuming UTC.
ALTER TABLE "deletion_tombstones" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp with time zone USING "deleted_at" AT TIME ZONE current_setting('TimeZone');
