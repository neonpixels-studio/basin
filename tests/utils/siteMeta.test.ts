import { describe, it, expect, vi, afterEach } from "vitest";
import { SITE_NAME, canonicalUrl } from "~/utils/siteMeta";

describe("SITE_NAME", () => {
  it("is the product name shared across every marketing page's meta tags", () => {
    expect(SITE_NAME).toBe("Reader");
  });
});

describe("canonicalUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins the configured site origin with the given path", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "https://reader.example" },
    }));
    expect(canonicalUrl("/pricing")).toBe("https://reader.example/pricing");
  });

  it("strips a trailing slash from the configured origin before joining", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "https://reader.example/" },
    }));
    expect(canonicalUrl("/about")).toBe("https://reader.example/about");
  });

  it("changes output when the configured origin changes", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "https://staging.reader.example" },
    }));
    expect(canonicalUrl("/contact")).toBe(
      "https://staging.reader.example/contact",
    );
  });

  it("falls back to the bare path when no site URL is configured", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({ public: { siteUrl: "" } }));
    expect(canonicalUrl("/privacy")).toBe("/privacy");
  });
});
