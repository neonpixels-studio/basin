// Orchestrates a full account deletion: stop billing, remove all stored data,
// then remove the identity. Kept in one place (rather than inline in the route)
// so the ordering and its rationale are testable in isolation.
import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import type { DbUser } from "./auth";
import { deleteClerkUser } from "./clerk";
import { cancelActiveSubscription } from "./subscriptions";

// Order matters:
//   1. Cancel the Stripe subscription while the `subscriptions` row still
//      exists — deleting the user first would drop the id we need to cancel,
//      leaving a deleted account billing forever.
//   2. Delete the `users` row. Every user-owned table (feeds, feed_items via
//      feeds, integrations with their OAuth tokens, user_settings,
//      subscriptions) declares ON DELETE CASCADE on user_id, so this one
//      delete removes all associated data.
//   3. Delete the Clerk user last. If an earlier step fails, the identity is
//      still intact and the user can retry; doing it last also means data is
//      already gone before we revoke the sessions that could observe it.
export async function deleteUserAccount(
  event: H3Event,
  user: DbUser,
): Promise<void> {
  await cancelActiveSubscription(user.id);
  await useDb().delete(users).where(eq(users.id, user.id));
  await deleteClerkUser(event, user.providerId);
}
