import { describe, it, expect } from "vitest";
import {
  requiresOriginCheck,
  isRequestOriginAllowed,
  ORIGIN_CHECK_EXEMPT_PATHS,
} from "../../../server/utils/originCheck";

const TARGET_ORIGIN = "https://basin.test";
const CROSS_ORIGIN = "https://evil.example";

describe("requiresOriginCheck", () => {
  it("requires the check for state-changing methods on API routes", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(requiresOriginCheck(method, "/api/sync")).toBe(true);
    }
  });

  it("skips safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(requiresOriginCheck(method, "/api/feeds")).toBe(false);
    }
  });

  it("treats the method case-insensitively", () => {
    expect(requiresOriginCheck("get", "/api/feeds")).toBe(false);
    expect(requiresOriginCheck("post", "/api/sync")).toBe(true);
  });

  it("skips non-API paths", () => {
    expect(requiresOriginCheck("POST", "/login")).toBe(false);
    expect(requiresOriginCheck("POST", "/_nuxt/entry.js")).toBe(false);
  });

  it("skips exempt webhook paths so signed machine traffic is never blocked", () => {
    for (const path of ORIGIN_CHECK_EXEMPT_PATHS) {
      expect(requiresOriginCheck("POST", path)).toBe(false);
    }
  });

  it("does not exempt a look-alike of a webhook path", () => {
    expect(requiresOriginCheck("POST", "/api/billing/webhook-test")).toBe(true);
  });
});

describe("isRequestOriginAllowed", () => {
  it("allows a same-origin fetch (Sec-Fetch-Site: same-origin)", () => {
    const allowed = isRequestOriginAllowed({
      origin: TARGET_ORIGIN,
      secFetchSite: "same-origin",
      targetOrigin: TARGET_ORIGIN,
    });
    expect(allowed).toBe(true);
  });

  it("allows same-site and user-initiated (none) fetches", () => {
    for (const secFetchSite of ["same-site", "none"]) {
      const allowed = isRequestOriginAllowed({
        origin: null,
        secFetchSite,
        targetOrigin: TARGET_ORIGIN,
      });
      expect(allowed).toBe(true);
    }
  });

  it("rejects a cross-site request even when the Origin header lies via Sec-Fetch-Site", () => {
    const allowed = isRequestOriginAllowed({
      origin: TARGET_ORIGIN,
      secFetchSite: "cross-site",
      targetOrigin: TARGET_ORIGIN,
    });
    expect(allowed).toBe(false);
  });

  it("fails closed on an unrecognized Sec-Fetch-Site value", () => {
    const allowed = isRequestOriginAllowed({
      origin: TARGET_ORIGIN,
      secFetchSite: "bogus",
      targetOrigin: TARGET_ORIGIN,
    });
    expect(allowed).toBe(false);
  });

  it("falls back to the Origin header when Sec-Fetch-Site is absent", () => {
    const sameOrigin = isRequestOriginAllowed({
      origin: TARGET_ORIGIN,
      secFetchSite: null,
      targetOrigin: TARGET_ORIGIN,
    });
    expect(sameOrigin).toBe(true);

    const crossOrigin = isRequestOriginAllowed({
      origin: CROSS_ORIGIN,
      secFetchSite: null,
      targetOrigin: TARGET_ORIGIN,
    });
    expect(crossOrigin).toBe(false);
  });

  it("allows a non-browser client that sends neither Sec-Fetch-Site nor Origin", () => {
    const allowed = isRequestOriginAllowed({
      origin: null,
      secFetchSite: null,
      targetOrigin: TARGET_ORIGIN,
    });
    expect(allowed).toBe(true);
  });
});
