// Isolates the Clerk backend SDK behind a small, mockable function so route
// handlers and orchestration code never touch `clerkClient` directly. See
// tests/server/utils/clerk.test.ts for the mocked-client unit tests.
import type { H3Event } from "h3";
import { clerkClient } from "@clerk/nuxt/server";
import { verifyWebhook } from "@clerk/nuxt/webhooks";
import type { WebhookEvent } from "@clerk/nuxt/webhooks";

// Permanently deletes the Clerk user (the identity behind our `provider_id`),
// which also revokes all of their active sessions.
export async function deleteClerkUser(
  event: H3Event,
  providerId: string,
): Promise<void> {
  await clerkClient(event).users.deleteUser(providerId);
}

// Verifies an incoming Clerk webhook (Svix signature) and returns the parsed
// event. Isolated here — the only file that imports Clerk's webhook verifier —
// so the route handler and tests never touch the SDK directly, mirroring
// stripe.ts's verifyWebhookSignature. Fails loud with a 500 when the signing
// secret is missing (a server misconfiguration, not a bad signature) so the
// route reports it as a retryable 5xx rather than masking it as a permanent
// 400 that Clerk won't retry.
export async function verifyClerkWebhook(
  event: H3Event,
): Promise<WebhookEvent> {
  const { clerk } = useRuntimeConfig(event);
  if (!clerk?.webhookSigningSecret) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Clerk is not configured: missing NUXT_CLERK_WEBHOOK_SIGNING_SECRET",
    });
  }
  return verifyWebhook(event);
}

// Minimal shape of the Clerk auth object we read here — kept local so the
// reverification gate depends on this seam, not on Clerk's exported types.
type ClerkAuthContext = {
  sessionClaims?: { fva?: unknown } | null;
};

// Reads Clerk's `fva` (factor verification age) session claim: a tuple of
// minutes `[since last first-factor verification, since last second-factor
// verification]`, where `-1` means the factor doesn't apply. Returns the ages of
// the factors that were actually verified (dropping the `-1` sentinels and any
// malformed entries), so a caller can accept whichever factor Clerk refreshed —
// its reverification modal defaults to the second factor for MFA users. Empty
// when the claim is absent or malformed. Isolated here so destructive-action
// gates can be unit-tested without a live Clerk session.
export function getFactorVerificationAgesMinutes(event: H3Event): number[] {
  const auth = readClerkAuthContext(event);
  const fva = auth?.sessionClaims?.fva;
  if (!Array.isArray(fva)) {
    return [];
  }
  return fva.filter(
    (ageMinutes): ageMinutes is number =>
      typeof ageMinutes === "number" && ageMinutes >= 0,
  );
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
