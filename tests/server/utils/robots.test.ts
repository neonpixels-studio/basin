import { describe, it, expect } from "vitest";
import { buildRobotsTxt } from "../../../server/utils/robots";

describe("buildRobotsTxt", () => {
  it("allows crawling by default", () => {
    const body = buildRobotsTxt("https://reader.example");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
  });

  it("disallows auth-gated app routes", () => {
    const body = buildRobotsTxt("https://reader.example");
    expect(body).toContain("Disallow: /dashboard");
    expect(body).toContain("Disallow: /settings");
    expect(body).toContain("Disallow: /login");
  });

  it("points the Sitemap directive at the given origin's sitemap.xml", () => {
    const body = buildRobotsTxt("https://reader.example");
    expect(body).toContain("Sitemap: https://reader.example/sitemap.xml");
  });

  it("anchors the Sitemap line to the given origin, not a hardcoded one", () => {
    const body = buildRobotsTxt("https://staging.reader.example");
    expect(body).toContain(
      "Sitemap: https://staging.reader.example/sitemap.xml",
    );
    expect(body).not.toContain("Sitemap: https://reader.example");
  });
});
