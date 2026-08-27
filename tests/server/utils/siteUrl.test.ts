import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUseRuntimeConfig = vi.fn();

vi.stubGlobal("useRuntimeConfig", mockUseRuntimeConfig);
vi.stubGlobal(
  "createError",
  (input: { statusCode?: number; statusMessage?: string }) => {
    const error = new Error(input.statusMessage) as Error & {
      statusCode?: number;
    };
    error.statusCode = input.statusCode;
    return error;
  },
);

import { getConfiguredSiteUrl } from "../../../server/utils/siteUrl";

describe("getConfiguredSiteUrl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the configured origin", () => {
    mockUseRuntimeConfig.mockReturnValue({
      siteUrl: "https://basin.example.com",
    });
    expect(getConfiguredSiteUrl()).toBe("https://basin.example.com");
  });

  it("normalizes to the origin, dropping any trailing path, slash, or query", () => {
    mockUseRuntimeConfig.mockReturnValue({
      siteUrl: "https://basin.example.com/some/path?x=1",
    });
    expect(getConfiguredSiteUrl()).toBe("https://basin.example.com");
  });

  it("trims surrounding whitespace before parsing", () => {
    mockUseRuntimeConfig.mockReturnValue({
      siteUrl: "  https://basin.example.com  ",
    });
    expect(getConfiguredSiteUrl()).toBe("https://basin.example.com");
  });

  it("throws a 500 when the site URL is an empty string", () => {
    mockUseRuntimeConfig.mockReturnValue({ siteUrl: "" });
    expect(getConfiguredSiteUrl).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws a 500 when the site URL is only whitespace", () => {
    mockUseRuntimeConfig.mockReturnValue({ siteUrl: "   " });
    expect(getConfiguredSiteUrl).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws a 500 when the site URL key is missing (undefined)", () => {
    mockUseRuntimeConfig.mockReturnValue({});
    expect(getConfiguredSiteUrl).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws a 500 when the value has no scheme (not an absolute URL)", () => {
    mockUseRuntimeConfig.mockReturnValue({ siteUrl: "basin.example.com" });
    expect(getConfiguredSiteUrl).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws a 500 for a non-http(s) scheme", () => {
    mockUseRuntimeConfig.mockReturnValue({
      siteUrl: "ftp://basin.example.com",
    });
    expect(getConfiguredSiteUrl).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("does not leak the env var name in the client-facing message", () => {
    mockUseRuntimeConfig.mockReturnValue({ siteUrl: "" });
    try {
      getConfiguredSiteUrl();
      expect.unreachable("expected getConfiguredSiteUrl to throw");
    } catch (caughtError) {
      expect((caughtError as Error).message).not.toContain("NUXT_SITE_URL");
    }
  });
});
