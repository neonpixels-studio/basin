import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetHeader = vi.fn();

vi.stubGlobal("setHeader", mockSetHeader);
vi.stubGlobal("useRuntimeConfig", () => ({
  siteUrl: "https://reader.example",
}));

import handler from "../../../server/routes/robots.txt";

describe("GET /robots.txt", () => {
  beforeEach(() => {
    mockSetHeader.mockReset();
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
});
