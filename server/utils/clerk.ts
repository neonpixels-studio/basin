// Isolates the Clerk backend SDK behind a small, mockable function so route
// handlers and orchestration code never touch `clerkClient` directly. See
// tests/server/utils/clerk.test.ts for the mocked-client unit tests.
import type { H3Event } from "h3";
import { clerkClient } from "@clerk/nuxt/server";

// Permanently deletes the Clerk user (the identity behind our `provider_id`),
// which also revokes all of their active sessions.
export async function deleteClerkUser(
  event: H3Event,
  providerId: string,
): Promise<void> {
  await clerkClient(event).users.deleteUser(providerId);
}
