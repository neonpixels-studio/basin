import { describe, it, expect } from "vitest";
import { buildSitemap, serializeUrlEntry } from "../../../server/utils/sitemap";

const ORIGIN = "https://reader.example";

describe("serializeUrlEntry", () => {
  it("escapes XML-significant characters in the resulting <loc>", () => {
    const entry = serializeUrlEntry("https://reader.example", "/a?b=1&c=2<3>4");
    expect(entry).toContain(
      "<loc>https://reader.example/a?b=1&amp;c=2&lt;3&gt;4</loc>",
    );
    expect(entry).not.toContain("&c=2<3>4");
  });
});

describe("buildSitemap", () => {
  it("includes every marketing route as an absolute <loc>", () => {
    const xml = buildSitemap(ORIGIN);
    expect(xml).toContain("<loc>https://reader.example/</loc>");
    expect(xml).toContain("<loc>https://reader.example/pricing</loc>");
    expect(xml).toContain("<loc>https://reader.example/about</loc>");
    expect(xml).toContain("<loc>https://reader.example/privacy</loc>");
    expect(xml).toContain("<loc>https://reader.example/contact</loc>");
  });

  it("does not include app-only routes", () => {
    const xml = buildSitemap(ORIGIN);
    expect(xml).not.toContain("/dashboard");
    expect(xml).not.toContain("/settings");
    expect(xml).not.toContain("/login");
  });

  it("anchors every <loc> to the given origin, not a hardcoded one", () => {
    const xml = buildSitemap("https://staging.reader.example");
    expect(xml).toContain("<loc>https://staging.reader.example/</loc>");
    expect(xml).not.toContain(ORIGIN);
  });

  it("emits a well-formed urlset document", () => {
    const xml = buildSitemap(ORIGIN);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain("</urlset>");
  });
});
