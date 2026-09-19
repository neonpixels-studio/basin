import { describe, it, expect } from "vitest";
import {
  MARKETING_ROUTES,
  normalizeRoutePath,
  isMarketingRoute,
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

  it("returns an empty string for a non-string input instead of throwing", () => {
    expect(normalizeRoutePath(undefined as unknown as string)).toBe("");
    expect(normalizeRoutePath(null as unknown as string)).toBe("");
  });
});

describe("isMarketingRoute", () => {
  it.each(MARKETING_ROUTES)("returns true for %s", (path) => {
    expect(isMarketingRoute(path)).toBe(true);
  });

  it("returns true for a marketing route with a trailing slash", () => {
    expect(isMarketingRoute("/pricing/")).toBe(true);
  });

  it("returns false for a non-marketing route", () => {
    expect(isMarketingRoute("/dashboard")).toBe(false);
    expect(isMarketingRoute("/login")).toBe(false);
  });
});
