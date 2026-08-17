import { describe, it, expect, vi } from "vitest";

// The seam lives in server/utils/clerk, which imports the Clerk SDK
// (unresolvable `#imports` under vitest); stub it — this gate never calls it.
vi.mock("@clerk/nuxt/server", () => ({ clerkClient: vi.fn() }));

import {
  assertRecentReverification,
  REVERIFICATION_MAX_AGE_MINUTES,
  REVERIFICATION_REQUIRED_CODE as SERVER_CODE,
} from "../../../server/utils/reverification";
import { REVERIFICATION_REQUIRED_CODE as CLIENT_CODE } from "~/composables/useReverification";

// Builds an event whose Clerk auth() reports a first-factor verification
// `minutes` old (second factor not applicable). `null` omits auth() entirely.
function eventWithVerificationAge(minutes: number | null) {
  if (minutes === null) {
    return { context: {} };
  }
  return eventWithFva([minutes, -1]);
}

// Builds an event with an explicit `fva` tuple for MFA scenarios.
function eventWithFva(fva: [number, number]) {
  return { context: { auth: () => ({ sessionClaims: { fva } }) } };
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

  it("passes when only the second factor was recently reverified (MFA)", () => {
    // Clerk's modal defaults to the second factor, so an MFA user's first factor
    // can be stale while the second is fresh — that must still count.
    const event = eventWithFva([45, 0]);
    expect(() => assertRecentReverification(event as never)).not.toThrow();
  });

  it("rejects when a stale first factor is the only applicable factor", () => {
    const event = eventWithFva([45, -1]);
    expect(() => assertRecentReverification(event as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("rejects with 403 when both factors are the -1 sentinel", () => {
    const event = eventWithFva([-1, -1]);
    expect(() => assertRecentReverification(event as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("shares the reverification code with the client composable", () => {
    // The client matches this code to open Clerk's modal; drift silently breaks
    // the gate's UX, so the duplicated constant is asserted equal here.
    expect(SERVER_CODE).toBe(CLIENT_CODE);
  });
});
