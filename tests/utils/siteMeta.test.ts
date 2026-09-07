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

  it("returns undefined rather than a relative URL when no site URL is configured", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({ public: { siteUrl: "" } }));
    expect(canonicalUrl("/privacy")).toBeUndefined();
  });

  it("returns undefined for a scheme-less value rather than a broken URL", () => {
    // A relative/scheme-less siteUrl would otherwise resolve against
    // whatever host served the page — the exact spoofable-Host outcome
    // canonicalUrl exists to avoid.
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "reader.example" },
    }));
    expect(canonicalUrl("/pricing")).toBeUndefined();
  });

  it("returns undefined for a non-http(s) protocol", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "javascript:alert(1)" },
    }));
    expect(canonicalUrl("/pricing")).toBeUndefined();
  });

  it("normalizes away an extraneous path on the configured site URL", () => {
    // Uses the URL's origin only, so a misconfigured value with a path
    // degrades to a correct bare origin instead of concatenating into a
    // malformed URL (e.g. "https://reader.example/apppricing").
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "https://reader.example/app" },
    }));
    expect(canonicalUrl("/pricing")).toBe("https://reader.example/pricing");
  });
});
