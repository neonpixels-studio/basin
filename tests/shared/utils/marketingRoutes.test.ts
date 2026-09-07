import { describe, it, expect } from "vitest";
import {
  MARKETING_ROUTES,
  normalizeRoutePath,
} from "#shared/utils/marketingRoutes";

describe("MARKETING_ROUTES", () => {
  it("lists exactly the five public marketing pages", () => {
    expect(MARKETING_ROUTES).toEqual([
      "/",
      "/pricing",
      "/about",
      "/privacy",
      "/contact",
    ]);
  });
});

describe("normalizeRoutePath", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeRoutePath("/pricing/")).toBe("/pricing");
  });

  it("leaves a path with no trailing slash unchanged", () => {
    expect(normalizeRoutePath("/pricing")).toBe("/pricing");
  });

  it("does not collapse the root path", () => {
    expect(normalizeRoutePath("/")).toBe("/");
  });
});
