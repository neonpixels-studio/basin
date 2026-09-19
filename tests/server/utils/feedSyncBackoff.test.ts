import { describe, it, expect } from "vitest";
import {
  computeBackoffDelayMs,
  computeNextRetryAt,
} from "../../../server/utils/feedSyncBackoff";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const BASE_BACKOFF_MS = 15 * MINUTE_MS;
const MAX_BACKOFF_MS = 24 * HOUR_MS;

describe("feedSyncBackoff", () => {
  describe("computeBackoffDelayMs()", () => {
    it("returns no delay when the feed has no consecutive failures", () => {
      expect(computeBackoffDelayMs(0)).toBe(0);
    });

    it("treats a negative failure count as no backoff", () => {
      expect(computeBackoffDelayMs(-3)).toBe(0);
    });

    it("waits one base interval after the first failure", () => {
      expect(computeBackoffDelayMs(1)).toBe(BASE_BACKOFF_MS);
    });

    it("doubles the delay with each additional consecutive failure", () => {
      expect(computeBackoffDelayMs(2)).toBe(BASE_BACKOFF_MS * 2);
      expect(computeBackoffDelayMs(3)).toBe(BASE_BACKOFF_MS * 4);
      expect(computeBackoffDelayMs(4)).toBe(BASE_BACKOFF_MS * 8);
    });

    it("caps the delay at the maximum backoff once the schedule exceeds it", () => {
      // 2^7 * 15min = 32h, past the 24h cap — every failure from here on is
      // pinned to the cap rather than growing unbounded.
      expect(computeBackoffDelayMs(8)).toBe(MAX_BACKOFF_MS);
      expect(computeBackoffDelayMs(9)).toBe(MAX_BACKOFF_MS);
    });

    it("stays at the cap for very large failure counts without overflowing", () => {
      expect(computeBackoffDelayMs(1000)).toBe(MAX_BACKOFF_MS);
      expect(Number.isFinite(computeBackoffDelayMs(1000))).toBe(true);
    });
  });

  describe("computeNextRetryAt()", () => {
    it("returns null when the feed has no consecutive failures", () => {
      expect(
        computeNextRetryAt(0, new Date("2026-01-01T00:00:00.000Z")),
      ).toBeNull();
    });

    it("offsets the given time by the backoff delay for the first failure", () => {
      const from = new Date("2026-01-01T00:00:00.000Z");

      const nextRetryAt = computeNextRetryAt(1, from);

      expect(nextRetryAt).toEqual(new Date(from.getTime() + BASE_BACKOFF_MS));
    });

    it("offsets by the escalating delay for later failures", () => {
      const from = new Date("2026-01-01T00:00:00.000Z");

      const nextRetryAt = computeNextRetryAt(3, from);

      expect(nextRetryAt).toEqual(
        new Date(from.getTime() + BASE_BACKOFF_MS * 4),
      );
    });

    it("does not mutate the provided from date", () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const before = from.getTime();

      computeNextRetryAt(5, from);

      expect(from.getTime()).toBe(before);
    });
  });
});
