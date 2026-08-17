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

// Minimal shape of the Clerk auth object we read here — kept local so the
// reverification gate depends on this seam, not on Clerk's exported types.
type ClerkAuthContext = {
  sessionClaims?: { fva?: unknown } | null;
};

// Reads Clerk's `fva` (factor verification age) session claim: a tuple of
// minutes `[since last first-factor verification, since last second-factor
// verification]`, where `-1` means the factor doesn't apply. Returns the
// first-factor age, or `null` when the claim is absent or malformed. Isolated
// here so destructive-action gates can be unit-tested without a live Clerk
// session — callers hand it a plain event with a stubbed `auth()`.
export function getFirstFactorVerificationAgeMinutes(
  event: H3Event,
): number | null {
  const auth = readClerkAuthContext(event);
  const fva = auth?.sessionClaims?.fva;
  if (!Array.isArray(fva)) {
    return null;
  }
  const firstFactorAgeMinutes = fva[0];
  if (typeof firstFactorAgeMinutes !== "number") {
    return null;
  }
  return firstFactorAgeMinutes;
}

function readClerkAuthContext(event: H3Event): ClerkAuthContext | undefined {
  try {
    return event.context.auth?.() as ClerkAuthContext | undefined;
  } catch {
    // Fail closed: an unloaded/misconfigured Clerk instance must not let a
    // caller past the gate — treat it as "no verification age available".
    return undefined;
  }
}
