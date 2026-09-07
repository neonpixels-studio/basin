import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import IndexPage from "~/pages/index.vue";

describe("home page (/)", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useSeoMeta).mockClear();
    vi.mocked(globalThis.useHead).mockClear();
  });

  it("emits og/twitter meta anchored to the configured site URL", () => {
    shallowMount(IndexPage);
    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reader — all your feeds, one quiet page",
        ogTitle: "Reader — all your feeds, one quiet page",
        ogType: "website",
        ogUrl: "https://basin.example/",
        ogSiteName: "Reader",
        twitterCard: "summary",
        twitterTitle: "Reader — all your feeds, one quiet page",
      }),
    );
  });

  it("emits a canonical link anchored to the configured site URL", () => {
    shallowMount(IndexPage);
    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://basin.example/" }],
    });
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
