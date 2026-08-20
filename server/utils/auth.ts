import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { users } from "../db/schema";
import { isProviderTombstoned } from "./tombstone";

export type DbUser = InferSelectModel<typeof users>;

declare module "h3" {
  interface H3EventContext {
    user?: DbUser;
  }
}

export function signupsDisabled(): boolean {
  // Read via runtimeConfig (not process.env) so the value bakes into the server
  // bundle at build time and survives into the deployed Netlify function.
  return useRuntimeConfig().disableSignups === "true";
}

// Reads the user row for a Clerk provider id, or undefined when none exists.
// Isolated so the deletion sweep and getOrCreateUser share one lookup and can
// be unit-tested without a live database.
export async function findUserByProviderId(
  providerId: string,
): Promise<DbUser | undefined> {
  return useDb().query.users.findFirst({
    where: eq(users.providerId, providerId),
  });
}

export async function getOrCreateUser(providerId: string): Promise<DbUser> {
  const db = useDb();

  const existing = await findUserByProviderId(providerId);
  if (existing) return existing;

  // A session minted just before account deletion stays valid until it expires
  // (Clerk verifies JWTs networklessly), so without this check the middleware
  // would re-insert an empty row for a deleted account on its next request.
  if (await isProviderTombstoned(providerId)) {
    throw createError({
      statusCode: 403,
      statusMessage: "This account has been deleted",
    });
  }

  if (signupsDisabled()) {
    throw createError({
      statusCode: 403,
      statusMessage: "Sign-ups are currently disabled",
    });
  }

  const [created] = await db.insert(users).values({ providerId }).returning();
  return created;
}
