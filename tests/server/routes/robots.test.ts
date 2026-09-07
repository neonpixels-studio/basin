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

import handler from "../../../server/routes/robots.txt";

describe("GET /robots.txt", () => {
  beforeEach(() => {
    mockSetHeader.mockReset();
    runtimeConfigValue.value = { siteUrl: "https://reader.example" };
  });

  it("serves robots.txt as plain text", () => {
    const event = {};
    handler(event as never);
    expect(mockSetHeader).toHaveBeenCalledWith(
      event,
      "Content-Type",
      "text/plain; charset=utf-8",
    );
  });

  it("points the Sitemap directive at the configured site origin", () => {
    const body = handler({} as never);
    expect(body).toContain("Sitemap: https://reader.example/sitemap.xml");
  });

  it("propagates the 500 from getConfiguredSiteUrl when NUXT_SITE_URL is unset", () => {
    runtimeConfigValue.value = { siteUrl: "" };
    expect(() => handler({} as never)).toThrowError(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});
