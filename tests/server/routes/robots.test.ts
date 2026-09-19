import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetHeader = vi.fn();
// Mutable so individual tests can flip the configured site URL, mirroring
// tests/server/utils/siteUrl.test.ts's pattern for the same helper.
const runtimeConfigValue: { value: Record<string, string> } = {
  value: { siteUrl: "https://reader.example" },
};

// NOTE: ESM hoists the `import` below above these stubGlobal calls, so
// server/routes/robots.txt is evaluated first. That's safe only because the
// route module reads setHeader/useRuntimeConfig/createError inside its
// handler function (invocation time), not at module scope — if it ever reads
// a global at module scope, these stubs must move into beforeAll/beforeEach.
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

  it("still serves crawl rules, minus the Sitemap directive, when NUXT_SITE_URL is unset", () => {
    // A 5xx robots.txt gets treated by crawlers as "disallow everything" —
    // this must degrade instead of propagating getConfiguredSiteUrl's throw
    // (see tests/server/utils/siteUrl.test.ts for that throw's own coverage).
    runtimeConfigValue.value = { siteUrl: "" };
    const body = handler({} as never);
    expect(body).toContain("Disallow: /dashboard");
    expect(body).not.toContain("Sitemap:");
  });
});
