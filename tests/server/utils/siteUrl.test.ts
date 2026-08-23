import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getConfiguredSiteUrl } from "../../../server/utils/siteUrl";

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

  it("throws 500 rather than silently stripping a path, query, or fragment", () => {
    runtimeConfigValue.value = {
      siteUrl: "https://basin.example/settings/account?x=1#frag",
    };
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
