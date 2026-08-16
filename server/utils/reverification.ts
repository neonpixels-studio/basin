// Server-side reverification gate for destructive actions. A leaked or borrowed
// bearer token alone must not be enough to run them: we require the session to
// have completed a recent factor verification (Clerk's `fva` claim). The client
// forces this via Clerk reverification, then retries with a fresh token.
import type { H3Event } from "h3";
import { getFirstFactorVerificationAgeMinutes } from "./clerk";

// Machine-readable code the client matches to trigger Clerk's reverification
// flow. Kept in sync with REVERIFICATION_REQUIRED_CODE in
// app/composables/useReverification.ts (the cross-boundary contract).
export const REVERIFICATION_REQUIRED_CODE = "reverification_required";

// How recently the user must have completed a first-factor verification for a
// destructive action to proceed. Mirrors Clerk's default "strict" reverification
// window so a token minted long before the request can't erase data.
export const REVERIFICATION_MAX_AGE_MINUTES = 10;

function reverificationRequiredError() {
  return createError({
    statusCode: 403,
    statusMessage: "Recent reverification is required to delete your account.",
    data: { code: REVERIFICATION_REQUIRED_CODE },
  });
}

// Throws a 403 unless the session carries a first-factor verification within the
// allowed window. A missing/negative age means the token can't prove a recent
// check, so it's rejected too.
export function assertRecentReverification(event: H3Event): void {
  const firstFactorAgeMinutes = getFirstFactorVerificationAgeMinutes(event);
  if (firstFactorAgeMinutes === null) {
    throw reverificationRequiredError();
  }
  if (firstFactorAgeMinutes < 0) {
    throw reverificationRequiredError();
  }
  if (firstFactorAgeMinutes > REVERIFICATION_MAX_AGE_MINUTES) {
    throw reverificationRequiredError();
  }
}
