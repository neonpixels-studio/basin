import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import AboutPage from "~/pages/about.vue";

describe("about page (/about)", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useSeoMeta).mockClear();
    vi.mocked(globalThis.useHead).mockClear();
    vi.stubGlobal("useRoute", () => ({
      path: "/about",
      params: {},
      query: {},
    }));
  });

  it("emits og/twitter meta anchored to the configured site URL", () => {
    shallowMount(AboutPage);
    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reader — about",
        ogTitle: "Reader — about",
        ogType: "website",
        ogUrl: "https://basin.example/about",
        ogSiteName: "Reader",
        twitterCard: "summary",
        twitterTitle: "Reader — about",
      }),
    );
  });

  it("emits a canonical link anchored to the configured site URL", () => {
    shallowMount(AboutPage);
    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://basin.example/about" }],
    });
  });

  it("renders the page header", () => {
    const wrapper = shallowMount(AboutPage);
    expect(wrapper.find(".page-top").exists()).toBe(true);
    expect(wrapper.find(".page-h1").exists()).toBe(true);
  });

  it("renders the six value cards", () => {
    const wrapper = shallowMount(AboutPage);
    expect(wrapper.findAll(".feat-grid .feature")).toHaveLength(6);
  });

  it("renders the story timeline", () => {
    const wrapper = shallowMount(AboutPage);
    expect(wrapper.findAll(".story .story-item")).toHaveLength(3);
  });

  it("renders the team members", () => {
    const wrapper = shallowMount(AboutPage);
    expect(wrapper.findAll(".team .member")).toHaveLength(4);
  });

  it("links to contact from the CTA", () => {
    const wrapper = shallowMount(AboutPage);
    expect(wrapper.find("a[href='/contact']").exists()).toBe(true);
  });
});
