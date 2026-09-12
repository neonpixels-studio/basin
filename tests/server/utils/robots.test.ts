import { describe, it, expect } from "vitest";
import { buildRobotsTxt } from "../../../server/utils/robots";

describe("buildRobotsTxt", () => {
  it("does not emit a redundant Allow: / directive", () => {
    // Unlisted paths are already crawlable by default per the robots.txt
    // spec, and an explicit "Allow: /" sitting next to the Disallow lines
    // below is easy to misread as contradicting them.
    const body = buildRobotsTxt("https://reader.example");
    expect(body).toContain("User-agent: *");
    expect(body).not.toContain("Allow: /");
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

  it("omits the Sitemap directive rather than throw when origin is undefined", () => {
    const body = buildRobotsTxt(undefined);
    expect(body).not.toContain("Sitemap:");
    expect(body).toContain("Disallow: /dashboard");
  });
});
