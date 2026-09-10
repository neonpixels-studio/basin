import { describe, it, expect } from "vitest";
import {
  isSecureSiteOrigin,
  requireValidSiteUrlForBuild,
  validateSiteUrl,
} from "../../../server/utils/siteUrlValidation";

// This is the shared rule set both server/utils/siteUrl.ts (request time) and
// nuxt.config.ts's requireSiteUrlForBuild (build time, via
// requireValidSiteUrlForBuild below) delegate to, so it is the single place
// valid/missing/malformed NUXT_SITE_URL behavior is exercised — see
// tests/server/utils/siteUrl.test.ts for the request-time wrapper's
// createError translation.
describe("validateSiteUrl", () => {
  it("accepts a bare https origin", () => {
    expect(validateSiteUrl("https://basin.example")).toEqual({
      valid: true,
      origin: "https://basin.example",
    });
  });

  it("accepts a bare http origin with a non-default port", () => {
    expect(validateSiteUrl("http://localhost:3000")).toEqual({
      valid: true,
      origin: "http://localhost:3000",
    });
  });

  it("accepts a trailing root slash", () => {
    expect(validateSiteUrl("https://basin.example/")).toEqual({
      valid: true,
      origin: "https://basin.example",
    });
  });

  it("rejects an undefined value", () => {
    const result = validateSiteUrl(undefined);
    expect(result).toEqual({
      valid: false,
      message: "Site URL is not configured: missing NUXT_SITE_URL",
    });
  });

  it("rejects an empty string", () => {
    const result = validateSiteUrl("");
    expect(result).toEqual({
      valid: false,
      message: "Site URL is not configured: missing NUXT_SITE_URL",
    });
  });

  it("rejects a value that is not a valid absolute URL", () => {
    const result = validateSiteUrl("not-a-url");
    expect(result).toEqual({
      valid: false,
      message: "Site URL is not configured as a valid absolute URL",
    });
  });

  it("rejects a non-http(s) protocol", () => {
    const result = validateSiteUrl("ftp://basin.example");
    expect(result).toEqual({
      valid: false,
      message: "Site URL must use the http or https protocol",
    });
  });

  it("rejects a value with an extra path segment", () => {
    const result = validateSiteUrl("https://basin.example/app");
    expect(result).toEqual({
      valid: false,
      message:
        "Site URL must be a bare origin with no path, query, fragment, or credentials",
    });
  });

  it("rejects a value with a query string", () => {
    const result = validateSiteUrl("https://basin.example?x=1");
    expect(result).toEqual({
      valid: false,
      message:
        "Site URL must be a bare origin with no path, query, fragment, or credentials",
    });
  });

  it("rejects a value with a fragment", () => {
    const result = validateSiteUrl("https://basin.example/#frag");
    expect(result).toEqual({
      valid: false,
      message:
        "Site URL must be a bare origin with no path, query, fragment, or credentials",
    });
  });

  it("rejects a value with embedded credentials", () => {
    const result = validateSiteUrl("https://ops:secret@basin.example");
    expect(result).toEqual({
      valid: false,
      message:
        "Site URL must be a bare origin with no path, query, fragment, or credentials",
    });
  });
});

describe("isSecureSiteOrigin", () => {
  it("returns true for an https origin", () => {
    expect(isSecureSiteOrigin("https://basin.example")).toBe(true);
  });

  it("returns false for an http origin", () => {
    expect(isSecureSiteOrigin("http://localhost:3000")).toBe(false);
  });
});

// This is the exact function nuxt.config.ts's requireSiteUrlForBuild calls —
// see the comment there for why the guard lives here instead of inline
// (nuxt.config.ts can't be imported directly in tests).
describe("requireValidSiteUrlForBuild", () => {
  it("returns the raw value unvalidated outside a production build", () => {
    expect(requireValidSiteUrlForBuild(undefined, false)).toBe("");
    expect(requireValidSiteUrlForBuild("not-a-url", false)).toBe("not-a-url");
  });

  it("returns a valid https origin's raw value for a production build", () => {
    expect(requireValidSiteUrlForBuild("https://basin.example", true)).toBe(
      "https://basin.example",
    );
  });

  it("throws when the site URL is missing for a production build", () => {
    expect(() => requireValidSiteUrlForBuild(undefined, true)).toThrowError(
      /missing NUXT_SITE_URL/,
    );
  });

  it("throws when the site URL is malformed for a production build", () => {
    expect(() => requireValidSiteUrlForBuild("not-a-url", true)).toThrowError(
      /valid absolute URL/,
    );
  });

  it("throws when the site URL has a path for a production build", () => {
    expect(() =>
      requireValidSiteUrlForBuild("https://basin.example/app", true),
    ).toThrowError(/bare origin/);
  });

  it("throws when a production build's site URL is http instead of https", () => {
    expect(() =>
      requireValidSiteUrlForBuild("http://basin.example", true),
    ).toThrowError(/must use https for a production build/);
  });
});
