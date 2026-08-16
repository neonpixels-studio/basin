import { describe, it, expect, vi } from "vitest";

// The seam lives in server/utils/clerk, which imports the Clerk SDK
// (unresolvable `#imports` under vitest); stub it — this gate never calls it.
vi.mock("@clerk/nuxt/server", () => ({ clerkClient: vi.fn() }));

import {
  assertRecentReverification,
  REVERIFICATION_MAX_AGE_MINUTES,
} from "../../../server/utils/reverification";

// Builds an event whose Clerk auth() reports a first-factor verification
// `minutes` old. `null` omits auth() entirely (no claim available).
function eventWithVerificationAge(minutes: number | null) {
  if (minutes === null) {
    return { context: {} };
  }
  return {
    context: { auth: () => ({ sessionClaims: { fva: [minutes, -1] } }) },
  };
}

describe("assertRecentReverification", () => {
  it("passes when the first factor was verified within the window", () => {
    const event = eventWithVerificationAge(REVERIFICATION_MAX_AGE_MINUTES - 1);
    expect(() => assertRecentReverification(event as never)).not.toThrow();
  });

  it("passes at the exact window boundary", () => {
    const event = eventWithVerificationAge(REVERIFICATION_MAX_AGE_MINUTES);
    expect(() => assertRecentReverification(event as never)).not.toThrow();
  });

  it("rejects with 403 when the verification is older than the window", () => {
    const event = eventWithVerificationAge(REVERIFICATION_MAX_AGE_MINUTES + 1);
    expect(() => assertRecentReverification(event as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("rejects with 403 when no fva claim is present", () => {
    const event = { context: { auth: () => ({ sessionClaims: {} }) } };
    expect(() => assertRecentReverification(event as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("rejects with 403 when the request has no auth context at all", () => {
    const event = eventWithVerificationAge(null);
    expect(() => assertRecentReverification(event as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("rejects with 403 when the first-factor age is the -1 sentinel", () => {
    const event = eventWithVerificationAge(-1);
    expect(() => assertRecentReverification(event as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});
