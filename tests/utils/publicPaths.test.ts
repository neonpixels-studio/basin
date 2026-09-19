import { describe, it, expect } from "vitest";
import { MARKETING_ROUTES } from "#shared/utils/marketingRoutes";
import { isCloakExemptPath } from "~/utils/publicPaths";

// normalizeRoutePath/isMarketingRoute's own behavior (trailing slash,
// non-string input) is covered by tests/shared/utils/marketingRoutes.test.ts
// — this file only asserts the cloak-exemption composition on top of it.
describe("isCloakExemptPath", () => {
  it.each(MARKETING_ROUTES)("returns true for public path %s", (path) => {
    expect(isCloakExemptPath(path)).toBe(true);
  });

  it("returns true for /login", () => {
    expect(isCloakExemptPath("/login")).toBe(true);
  });

  it("returns true for /login with a trailing slash", () => {
    expect(isCloakExemptPath("/login/")).toBe(true);
  });

  it("returns false for authenticated routes", () => {
    expect(isCloakExemptPath("/dashboard")).toBe(false);
    expect(isCloakExemptPath("/settings")).toBe(false);
    expect(isCloakExemptPath("/settings/account")).toBe(false);
  });
});
