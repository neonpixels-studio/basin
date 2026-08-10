import { describe, it, expect } from "vitest";
import { durationLabel } from "~/utils/duration";

describe("durationLabel", () => {
  it("formats a positive duration", () => {
    expect(durationLabel(754)).toBe("12:34");
    expect(durationLabel(3661)).toBe("1:01:01");
  });

  it("returns an empty string for null/undefined/non-numeric/zero durations", () => {
    expect(durationLabel(null)).toBe("");
    expect(durationLabel(undefined)).toBe("");
    expect(durationLabel(0)).toBe("");
    expect(durationLabel("nope")).toBe("");
  });
});
