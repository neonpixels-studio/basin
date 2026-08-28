import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatRelativeTime,
  isRelativeTime,
  readerTimeLabel,
} from "~/utils/feedTime";

describe("formatRelativeTime", () => {
  it("returns empty string for null", () => {
    expect(formatRelativeTime(null)).toBe("");
  });

  it("formats minutes for dates less than 1 hour ago", () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000);
    expect(formatRelativeTime(thirtyMinutesAgo)).toBe("30m");
  });

  it("formats hours for dates less than 24 hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h");
  });

  it("formats days for dates less than 7 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    expect(formatRelativeTime(threeDaysAgo)).toBe("3d");
  });

  it("formats as month and day for dates older than 7 days", () => {
    // Use a local noon timestamp to avoid timezone-induced date shifts.
    const oldDate = new Date(2024, 0, 5, 12, 0, 0);
    expect(formatRelativeTime(oldDate)).toMatch(/Jan 5/);
  });

  it("floors a future-dated item at 0m instead of a negative token", () => {
    const twoHoursAhead = new Date(Date.now() + 2 * 3_600_000);
    expect(formatRelativeTime(twoHoursAhead)).toBe("0m");
  });
});

describe("isRelativeTime", () => {
  it("recognizes minute/hour/day tokens as relative", () => {
    expect(isRelativeTime("30m")).toBe(true);
    expect(isRelativeTime("2h")).toBe(true);
    expect(isRelativeTime("3d")).toBe(true);
  });

  it("treats absolute dates as non-relative", () => {
    expect(isRelativeTime("Aug 5")).toBe(false);
    expect(isRelativeTime("Jan 12")).toBe(false);
    expect(isRelativeTime("")).toBe(false);
  });
});

describe("readerTimeLabel", () => {
  it("appends ' ago' to relative tokens", () => {
    expect(readerTimeLabel("3h")).toBe("3h ago");
    expect(readerTimeLabel("2d")).toBe("2d ago");
  });

  it("leaves an absolute date unchanged (never 'Aug 5 ago')", () => {
    expect(readerTimeLabel("Aug 5")).toBe("Aug 5");
  });

  it("returns an empty string for null/undefined/empty time", () => {
    expect(readerTimeLabel(null)).toBe("");
    expect(readerTimeLabel(undefined)).toBe("");
    expect(readerTimeLabel("")).toBe("");
  });

  it("floors a future-dated item to '0m ago' end to end", () => {
    const twoHoursAhead = new Date(Date.now() + 2 * 3_600_000);
    expect(readerTimeLabel(formatRelativeTime(twoHoursAhead))).toBe("0m ago");
  });
});

// Binds the parser to the producer. readerTimeLabel only appends " ago" when
// isRelativeTime matches, so every formatRelativeTime output must be either a
// recognized relative token or an absolute date. A new bucket (e.g. a weeks
// "3w" tier) added without teaching RELATIVE_TIME_PATTERN about it would be
// neither, silently dropping " ago" in the reader — the classifiability sweep
// fails loudly on that. Clock is frozen so boundary cases are exact, not racing
// two Date.now() reads. ABSOLUTE_DATE tolerates an optional year so it asserts
// the shape without pinning the formatter to a year-less format.
describe("formatRelativeTime ↔ isRelativeTime contract", () => {
  const NOW = new Date("2026-01-15T12:00:00Z");
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const ABSOLUTE_DATE = /^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/;

  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits only classifiable tokens (relative OR absolute) up to a year out", () => {
    for (let hours = 0; hours <= 365 * 24; hours += 6) {
      const token = formatRelativeTime(ago(hours * HOUR));
      const classified = isRelativeTime(token) || ABSOLUTE_DATE.test(token);
      expect(classified, `unclassified token "${token}" at ${hours}h`).toBe(
        true,
      );
    }
  });

  it("uses relative tokens up to the boundary and absolute dates past it", () => {
    expect(formatRelativeTime(ago(0))).toBe("0m");
    expect(formatRelativeTime(ago(59 * 60_000))).toBe("59m");
    expect(formatRelativeTime(ago(HOUR))).toBe("1h");
    expect(formatRelativeTime(ago(24 * HOUR - 60_000))).toBe("23h");
    expect(formatRelativeTime(ago(DAY))).toBe("1d");
    expect(formatRelativeTime(ago(7 * DAY - 60_000))).toBe("6d");
    expect(formatRelativeTime(ago(7 * DAY))).toMatch(ABSOLUTE_DATE);
    expect(formatRelativeTime(ago(400 * DAY))).toMatch(ABSOLUTE_DATE);
  });
});
