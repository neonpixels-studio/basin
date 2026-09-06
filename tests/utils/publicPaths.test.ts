import { describe, it, expect } from "vitest";
import {
  PUBLIC_PATHS,
  normalizePath,
  isPublicPath,
  isUnauthenticatedRoute,
} from "~/utils/publicPaths";

describe("normalizePath", () => {
  it("strips a single trailing slash", () => {
    expect(normalizePath("/pricing/")).toBe("/pricing");
  });

  it("leaves a path without a trailing slash unchanged", () => {
    expect(normalizePath("/pricing")).toBe("/pricing");
  });

  it("leaves the root path unchanged", () => {
    expect(normalizePath("/")).toBe("/");
  });
});

describe("isPublicPath", () => {
  it.each(PUBLIC_PATHS)("returns true for %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it("returns true for a public path with a trailing slash", () => {
    expect(isPublicPath("/pricing/")).toBe(true);
  });

  it("returns false for /login", () => {
    expect(isPublicPath("/login")).toBe(false);
  });

  it("returns false for an authenticated route", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
  });
});

describe("isUnauthenticatedRoute", () => {
  it.each(PUBLIC_PATHS)("returns true for public path %s", (path) => {
    expect(isUnauthenticatedRoute(path)).toBe(true);
  });

  it("returns true for /login", () => {
    expect(isUnauthenticatedRoute("/login")).toBe(true);
  });

  it("returns true for /login with a trailing slash", () => {
    expect(isUnauthenticatedRoute("/login/")).toBe(true);
  });

  it("returns false for authenticated routes", () => {
    expect(isUnauthenticatedRoute("/dashboard")).toBe(false);
    expect(isUnauthenticatedRoute("/settings")).toBe(false);
    expect(isUnauthenticatedRoute("/settings/account")).toBe(false);
  });
});
