import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Lets individual tests override the runtime config returned below.
const runtimeConfigValue: { value: Record<string, string> | null } = {
  value: null,
};

vi.stubGlobal(
  "useRuntimeConfig",
  () => runtimeConfigValue.value ?? { siteUrl: "https://basin.example" },
);
vi.stubGlobal(
  "createError",
  (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), {
      statusCode: input.statusCode,
    }),
);

import {
  getConfiguredSiteUrl,
  isConfiguredSiteUrlSecure,
} from "../../../server/utils/siteUrl";

describe("getConfiguredSiteUrl", () => {
  beforeEach(() => {
    runtimeConfigValue.value = null;
  });

  it("returns the configured origin", () => {
    expect(getConfiguredSiteUrl()).toBe("https://basin.example");
  });

  it("allows a bare origin with a trailing root slash", () => {
    runtimeConfigValue.value = { siteUrl: "https://basin.example/" };
    expect(getConfiguredSiteUrl()).toBe("https://basin.example");
  });

  it("preserves a non-default port in the origin", () => {
    runtimeConfigValue.value = { siteUrl: "http://localhost:3000" };
    expect(getConfiguredSiteUrl()).toBe("http://localhost:3000");
  });

  it("throws 500 rather than silently stripping a path", () => {
    runtimeConfigValue.value = { siteUrl: "https://basin.example/app" };
    expect(() => getConfiguredSiteUrl()).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws 500 rather than silently stripping a query", () => {
    runtimeConfigValue.value = { siteUrl: "https://basin.example?x=1" };
    expect(() => getConfiguredSiteUrl()).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws 500 rather than silently stripping a fragment", () => {
    runtimeConfigValue.value = { siteUrl: "https://basin.example/#frag" };
    expect(() => getConfiguredSiteUrl()).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws 500 rather than silently stripping embedded credentials", () => {
    runtimeConfigValue.value = { siteUrl: "https://ops:secret@basin.example" };
    expect(() => getConfiguredSiteUrl()).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws 500 when the site URL is missing", () => {
    runtimeConfigValue.value = { siteUrl: "" };
    // Assert the message so this exercises the explicit missing-value guard and
    // not merely the downstream URL-parse failure that an empty string also
    // triggers.
    expect(() => getConfiguredSiteUrl()).toThrowError(/missing NUXT_SITE_URL/);
  });

  it("throws 500 when the site URL is not a valid absolute URL", () => {
    runtimeConfigValue.value = { siteUrl: "not-a-url" };
    expect(() => getConfiguredSiteUrl()).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("throws 500 when the site URL uses a non-http(s) protocol", () => {
    runtimeConfigValue.value = { siteUrl: "ftp://basin.example" };
    expect(() => getConfiguredSiteUrl()).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});

describe("isConfiguredSiteUrlSecure", () => {
  beforeEach(() => {
    runtimeConfigValue.value = null;
    vi.stubEnv("NODE_ENV", "test");
  });

  // process.env.NODE_ENV is process-global state; without this, a stub from
  // one test (esp. "production") would silently leak into whichever test
  // runs next if this describe block is ever reordered or extended.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when the configured site URL is https", () => {
    runtimeConfigValue.value = { siteUrl: "https://basin.example" };
    expect(isConfiguredSiteUrlSecure()).toBe(true);
  });

  it("returns false when the configured site URL is http", () => {
    runtimeConfigValue.value = { siteUrl: "http://localhost:3000" };
    expect(isConfiguredSiteUrlSecure()).toBe(false);
  });

  it("propagates the configuration error when the site URL is unset", () => {
    runtimeConfigValue.value = { siteUrl: "" };
    expect(() => isConfiguredSiteUrlSecure()).toThrowError(
      /missing NUXT_SITE_URL/,
    );
  });

  it("returns true when the configured site URL is https in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    runtimeConfigValue.value = { siteUrl: "https://basin.example" };
    expect(isConfiguredSiteUrlSecure()).toBe(true);
  });

  it("throws a named config error rather than failing open when production resolves to http", () => {
    // A production deploy is always https in practice, so a stray http
    // siteUrl there is a misconfiguration, not a legitimate case — fail
    // loud with an actionable message rather than silently shipping the
    // CSRF state cookie without `secure`.
    vi.stubEnv("NODE_ENV", "production");
    runtimeConfigValue.value = { siteUrl: "http://basin.example" };
    expect(() => isConfiguredSiteUrlSecure()).toThrowError(
      expect.objectContaining({
        statusCode: 500,
        message: expect.stringMatching(/https in production/),
      }),
    );
  });

  it("throws the missing-config error (not the production https error) when unset in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    runtimeConfigValue.value = { siteUrl: "" };
    expect(() => isConfiguredSiteUrlSecure()).toThrowError(
      /missing NUXT_SITE_URL/,
    );
  });
});
