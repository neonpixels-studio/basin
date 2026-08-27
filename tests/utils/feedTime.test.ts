import { describe, it, expect } from "vitest";
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

// Binds the parser to the producer so a new relative bucket (e.g. "3w") added
// to formatRelativeTime without updating RELATIVE_TIME_PATTERN fails here
// instead of silently dropping " ago" in the reader.
describe("formatRelativeTime ↔ isRelativeTime contract", () => {
  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000);

  it("classifies every within-window formatter output as relative", () => {
    expect(isRelativeTime(formatRelativeTime(minutesAgo(30)))).toBe(true);
    expect(isRelativeTime(formatRelativeTime(minutesAgo(2 * 60)))).toBe(true);
    expect(isRelativeTime(formatRelativeTime(minutesAgo(3 * 24 * 60)))).toBe(
      true,
    );
  });

  it("classifies an out-of-window formatter output as absolute", () => {
    expect(isRelativeTime(formatRelativeTime(minutesAgo(60 * 24 * 60)))).toBe(
      false,
    );
  });
});
