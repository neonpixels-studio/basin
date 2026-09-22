import { describe, it, expect } from "vitest";
import {
  isSecureSiteOrigin,
  requireValidSiteUrlForBuild,
  resolvePublicSiteUrl,
  validateSiteUrl,
} from "../../../server/utils/siteUrlValidation";

// This is the shared rule set both server/utils/siteUrl.ts (request time) and
// nuxt.config.ts's requireSiteUrlForBuild (build time, via
// requireValidSiteUrlForBuild below) delegate to — see
// tests/server/utils/siteUrl.test.ts for the request-time wrapper's
// createError translation (it re-exercises the same cases through that
// wrapper, rather than relying on this file alone).
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

  it("returns a valid https origin for a production build", () => {
    expect(requireValidSiteUrlForBuild("https://basin.example", true)).toBe(
      "https://basin.example",
    );
  });

  it("returns the normalized origin, not the raw value, for a production build", () => {
    // A trailing root slash is accepted by validateSiteUrl but should not
    // flow through verbatim — the build guard's output becomes
    // runtimeConfig.siteUrl, and getConfiguredSiteUrl() would itself derive
    // the slash-less origin from this same raw value at request time.
    expect(requireValidSiteUrlForBuild("https://basin.example/", true)).toBe(
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

// This is the function nuxt.config.ts calls to bake runtimeConfig.public.siteUrl
// — see its own comment for why NUXT_PUBLIC_SITE_URL takes precedence (it's
// the value Nitro can also override from the live environment at Netlify
// Function runtime, unlike NUXT_SITE_URL and every other dotenvx-only value).
describe("resolvePublicSiteUrl", () => {
  it("prefers the public override when both are set", () => {
    expect(
      resolvePublicSiteUrl(
        "https://preview-123.example",
        "https://basin.example",
        true,
      ),
    ).toBe("https://preview-123.example");
  });

  it("falls back to the private site URL when no public override is set", () => {
    expect(resolvePublicSiteUrl(undefined, "https://basin.example", true)).toBe(
      "https://basin.example",
    );
    expect(resolvePublicSiteUrl("", "https://basin.example", true)).toBe(
      "https://basin.example",
    );
  });

  it("returns an empty string when neither is set", () => {
    expect(resolvePublicSiteUrl(undefined, undefined, true)).toBe("");
    expect(resolvePublicSiteUrl("", "", true)).toBe("");
  });

  it("falls back the same way outside a production build (nuxt dev)", () => {
    expect(
      resolvePublicSiteUrl(undefined, "http://localhost:3000", false),
    ).toBe("http://localhost:3000");
    expect(resolvePublicSiteUrl("", "http://localhost:3000", false)).toBe(
      "http://localhost:3000",
    );
    expect(resolvePublicSiteUrl(undefined, undefined, false)).toBe("");
  });

  it("returns the raw public override unvalidated outside a production build", () => {
    expect(resolvePublicSiteUrl("not-a-url", undefined, false)).toBe(
      "not-a-url",
    );
    expect(resolvePublicSiteUrl("http://basin.example", undefined, false)).toBe(
      "http://basin.example",
    );
  });

  it("returns the normalized origin, not the raw value, for a production build", () => {
    expect(
      resolvePublicSiteUrl("https://basin.example/", undefined, true),
    ).toBe("https://basin.example");
  });

  it("throws for a production build when the public override is malformed", () => {
    expect(() =>
      resolvePublicSiteUrl("not-a-url", undefined, true),
    ).toThrowError(/valid absolute URL/);
  });

  it("throws for a production build when the public override has a path", () => {
    expect(() =>
      resolvePublicSiteUrl("https://basin.example/app", undefined, true),
    ).toThrowError(/bare origin/);
  });

  it("throws for a production build when the public override is http instead of https", () => {
    expect(() =>
      resolvePublicSiteUrl("http://basin.example", undefined, true),
    ).toThrowError(/must use https for a production build/);
  });

  it("does not itself validate the fallback value passed in for rawSiteUrl", () => {
    // resolvePublicSiteUrl only validates rawPublicSiteUrl; it trusts
    // whatever rawSiteUrl it's given. In nuxt.config.ts this is always the
    // already-validated, normalized value requireSiteUrlForBuild returned
    // for the private `siteUrl` key (see resolvedSiteUrl there) — never the
    // raw, un-normalized process.env.NUXT_SITE_URL — so both keys stay in
    // sync. This test exercises resolvePublicSiteUrl in isolation with a
    // deliberately-unvalidated value to pin down that it's a pure passthrough
    // here, not a second validation pass.
    expect(resolvePublicSiteUrl(undefined, "not-a-url", true)).toBe(
      "not-a-url",
    );
  });
});
