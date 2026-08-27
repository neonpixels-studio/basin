import { describe, it, expect } from "vitest";
import { isRelativeTime, readerTimeLabel } from "~/utils/feedTime";

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
});
