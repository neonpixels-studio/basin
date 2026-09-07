import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetHeader = vi.fn();
// Mutable so individual tests can flip the configured site URL, mirroring
// tests/server/utils/siteUrl.test.ts's pattern for the same helper.
const runtimeConfigValue: { value: Record<string, string> } = {
  value: { siteUrl: "https://reader.example" },
};

vi.stubGlobal("setHeader", mockSetHeader);
vi.stubGlobal("useRuntimeConfig", () => runtimeConfigValue.value);
vi.stubGlobal(
  "createError",
  (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), {
      statusCode: input.statusCode,
    }),
);

import handler from "../../../server/routes/sitemap.xml";

describe("GET /sitemap.xml", () => {
  beforeEach(() => {
    mockSetHeader.mockReset();
    runtimeConfigValue.value = { siteUrl: "https://reader.example" };
  });

  it("serves the sitemap as XML", () => {
    const event = {};
    handler(event as never);
    expect(mockSetHeader).toHaveBeenCalledWith(
      event,
      "Content-Type",
      "application/xml; charset=utf-8",
    );
  });

  it("anchors every route to the configured site origin", () => {
    const xml = handler({} as never);
    expect(xml).toContain("<loc>https://reader.example/</loc>");
    expect(xml).toContain("<loc>https://reader.example/pricing</loc>");
  });

  it("propagates the 500 from getConfiguredSiteUrl when NUXT_SITE_URL is unset", () => {
    runtimeConfigValue.value = { siteUrl: "" };
    expect(() => handler({} as never)).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});
