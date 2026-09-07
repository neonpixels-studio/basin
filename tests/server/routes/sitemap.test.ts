import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetHeader = vi.fn();

vi.stubGlobal("setHeader", mockSetHeader);
vi.stubGlobal("useRuntimeConfig", () => ({
  siteUrl: "https://reader.example",
}));

import handler from "../../../server/routes/sitemap.xml";

describe("GET /sitemap.xml", () => {
  beforeEach(() => {
    mockSetHeader.mockReset();
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
});
