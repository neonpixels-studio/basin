import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hashProviderId,
  isHashedProviderId,
  TombstonePepperError,
} from "../../../server/utils/tombstoneHash";

const TEST_PEPPER = "test-tombstone-pepper-0123456789";

function expectedHash(providerId: string, pepper: string): string {
  return createHash("sha256")
    .update(providerId + pepper)
    .digest("hex");
}

describe("hashProviderId", () => {
  beforeEach(() => {
    vi.stubEnv("TOMBSTONE_ID_PEPPER", TEST_PEPPER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns sha256(provider_id + pepper) as a 64-char hex digest", () => {
    const hash = hashProviderId("user_abc");

    expect(hash).toBe(expectedHash("user_abc", TEST_PEPPER));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same provider id and pepper", () => {
    expect(hashProviderId("user_abc")).toBe(hashProviderId("user_abc"));
  });

  it("never returns the raw provider id", () => {
    expect(hashProviderId("user_abc")).not.toBe("user_abc");
  });

  it("produces different hashes for different provider ids", () => {
    expect(hashProviderId("user_abc")).not.toBe(hashProviderId("user_xyz"));
  });

  it("changes when the pepper changes, so a leaked hash cannot be re-derived without it", () => {
    const withFirstPepper = hashProviderId("user_abc");

    vi.stubEnv("TOMBSTONE_ID_PEPPER", "a-different-pepper-value-987654321");
    const withSecondPepper = hashProviderId("user_abc");

    expect(withSecondPepper).not.toBe(withFirstPepper);
  });

  it("throws TombstonePepperError when the pepper is unset", () => {
    vi.stubEnv("TOMBSTONE_ID_PEPPER", "");

    expect(() => hashProviderId("user_abc")).toThrow(TombstonePepperError);
  });

  it("throws TombstonePepperError when the pepper is too short", () => {
    vi.stubEnv("TOMBSTONE_ID_PEPPER", "tooshort");

    expect(() => hashProviderId("user_abc")).toThrow(TombstonePepperError);
  });
});

describe("isHashedProviderId", () => {
  it("is true for a sha256 hex digest", () => {
    expect(isHashedProviderId("a".repeat(64))).toBe(true);
  });

  it("is false for a raw Clerk provider id", () => {
    expect(isHashedProviderId("user_2abcDEF")).toBe(false);
  });

  it("is false for a hex string of the wrong length", () => {
    expect(isHashedProviderId("abc123")).toBe(false);
  });
});
