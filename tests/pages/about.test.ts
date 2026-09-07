import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import AboutPage from "~/pages/about.vue";

describe("about page (/about)", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useMarketingSeo).mockClear();
    vi.stubGlobal("useRoute", () => ({
      path: "/about",
      params: {},
      query: {},
    }));
  });

  // The og/twitter/canonical shape is asserted once, in
  // tests/composables/useMarketingSeo.test.ts — this only checks the page
  // wires up the composable with its own title/description.
  it("wires up marketing SEO meta for this page", () => {
    shallowMount(AboutPage);
    expect(globalThis.useMarketingSeo).toHaveBeenCalledWith(
      "Reader — about",
      "Reader is a small, independent team building one calm page for the feeds you already care about — no ranking, no ads, no infinite scroll.",
    );
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
