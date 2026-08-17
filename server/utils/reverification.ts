// Server-side reverification gate for destructive actions. A leaked or borrowed
// bearer token alone must not be enough to run them: we require the session to
// have completed a recent factor verification (Clerk's `fva` claim). The client
// forces this via Clerk reverification, then retries with a fresh token.
import type { H3Event } from "h3";
import { getFactorVerificationAgesMinutes } from "./clerk";

// Machine-readable code the client matches to trigger Clerk's reverification
// flow. Kept in sync with REVERIFICATION_REQUIRED_CODE in
// app/composables/useReverification.ts (the cross-boundary contract).
export const REVERIFICATION_REQUIRED_CODE = "reverification_required";

// How recently the user must have completed a factor verification for a
// destructive action to proceed. Mirrors Clerk's default "strict" reverification
// window so a token minted long before the request can't erase data.
export const REVERIFICATION_MAX_AGE_MINUTES = 10;

function reverificationRequiredError(actionDescription: string) {
  return createError({
    statusCode: 403,
    statusMessage: `Recent reverification is required to ${actionDescription}.`,
    data: { code: REVERIFICATION_REQUIRED_CODE },
  });
}

// Throws a 403 unless the session reverified a factor within the allowed window.
// `actionDescription` names the guarded action in the error message so the gate
// stays reusable beyond account deletion.
export function assertRecentReverification(
  event: H3Event,
  actionDescription = "perform this action",
): void {
  const verificationAgesMinutes = getFactorVerificationAgesMinutes(event);
  if (verificationAgesMinutes.length === 0) {
    // No usable factor age at all: a session that never verified, a route
    // missing Clerk middleware, or a JWT template without `fva`. Log it so a
    // misconfiguration is visible rather than silently blocking every user —
    // distinct from an ordinary stale session, which carries a real age below.
    console.error(
      "Clerk `fva` claim unavailable; reverification gate cannot evaluate a factor age and is rejecting the request.",
    );
    throw reverificationRequiredError(actionDescription);
  }
  // Recently verified if ANY factor was reverified within the window — Clerk's
  // modal defaults to the second factor for MFA users, so a fresh first factor
  // isn't guaranteed.
  const isRecentlyVerified = verificationAgesMinutes.some(
    (ageMinutes) => ageMinutes <= REVERIFICATION_MAX_AGE_MINUTES,
  );
  if (!isRecentlyVerified) {
    throw reverificationRequiredError(actionDescription);
  }
}
