import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import IndexPage from "~/pages/index.vue";

describe("home page (/)", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useMarketingSeo).mockClear();
    vi.stubGlobal("useRoute", () => ({
      path: "/",
      params: {},
      query: {},
    }));
  });

  // The og/twitter/canonical shape is asserted once, in
  // tests/composables/useMarketingSeo.test.ts — this only checks the page
  // wires up the composable with its own title/description.
  it("wires up marketing SEO meta for this page", () => {
    shallowMount(IndexPage);
    expect(globalThis.useMarketingSeo).toHaveBeenCalledWith(
      "Reader — all your feeds, one quiet page",
      "Stop checking multiple apps. Reader folds RSS, podcasts, YouTube and Bluesky into one timeline — no ranking, no ads, no doomscroll.",
    );
  });

  it("renders the hero section", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.find("section.hero").exists()).toBe(true);
  });

  it("renders the features section", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.find("#features").exists()).toBe(true);
  });

  it("renders the how-it-works section", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.find("#how").exists()).toBe(true);
  });

  it("renders the CTA band", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.find(".cta-band").exists()).toBe(true);
  });

  it("renders all six feature cards", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.findAll(".feature")).toHaveLength(6);
  });

  it("renders three steps", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.findAll(".step")).toHaveLength(3);
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(IndexPage);
    expect(wrapper.html()).toMatchSnapshot();
  });
});
