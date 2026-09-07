import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMarketingSeo } from "~/composables/useMarketingSeo";

describe("useMarketingSeo", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useSeoMeta).mockClear();
    vi.mocked(globalThis.useHead).mockClear();
    vi.stubGlobal("useRoute", () => ({
      path: "/about",
      params: {},
      query: {},
    }));
    vi.stubGlobal("useRuntimeConfig", () => ({
      public: { siteUrl: "https://reader.example" },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits og/twitter meta derived from the given title and description", () => {
    useMarketingSeo("Reader — about", "A calm reading app.");

    expect(globalThis.useSeoMeta).toHaveBeenCalledWith({
      title: "Reader — about",
      description: "A calm reading app.",
      ogTitle: "Reader — about",
      ogDescription: "A calm reading app.",
      ogType: "website",
      ogUrl: "https://reader.example/about",
      ogSiteName: "Reader",
      twitterCard: "summary",
      twitterTitle: "Reader — about",
      twitterDescription: "A calm reading app.",
    });
  });

  it("emits a canonical link anchored to the current route's path", () => {
    useMarketingSeo("Reader — about", "A calm reading app.");

    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://reader.example/about" }],
    });
  });

  it("reflects a different route's path in both ogUrl and the canonical link", () => {
    vi.stubGlobal("useRoute", () => ({
      path: "/contact",
      params: {},
      query: {},
    }));

    useMarketingSeo("Reader — contact", "Get in touch.");

    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({ ogUrl: "https://reader.example/contact" }),
    );
    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://reader.example/contact" }],
    });
  });

  it("normalizes a trailing slash so it matches the sitemap's canonical form", () => {
    // The auth middleware (app/middleware/auth.global.ts) already treats
    // "/pricing/" as "/pricing" — the SEO tags must agree, or the two
    // requests would each self-canonicalize to a different URL for the same
    // page.
    vi.stubGlobal("useRoute", () => ({
      path: "/pricing/",
      params: {},
      query: {},
    }));

    useMarketingSeo("Pricing — Reader", "Simple, quiet pricing.");

    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({ ogUrl: "https://reader.example/pricing" }),
    );
    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://reader.example/pricing" }],
    });
  });

  it("omits ogUrl and the canonical link when no site URL is configured", () => {
    vi.stubGlobal("useRuntimeConfig", () => ({ public: { siteUrl: "" } }));

    useMarketingSeo("Reader — about", "A calm reading app.");

    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({ ogUrl: undefined }),
    );
    expect(globalThis.useHead).not.toHaveBeenCalled();
  });
});
