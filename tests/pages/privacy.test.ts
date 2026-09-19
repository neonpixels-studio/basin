import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import PrivacyPage from "~/pages/privacy.vue";

describe("privacy page (/privacy)", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useMarketingSeo).mockClear();
    vi.stubGlobal("useRoute", () => ({
      path: "/privacy",
      params: {},
      query: {},
    }));
  });

  // The og/twitter/canonical shape is asserted once, in
  // tests/composables/useMarketingSeo.test.ts — this only checks the page
  // wires up the composable with its own title/description.
  it("wires up marketing SEO meta for this page", () => {
    shallowMount(PrivacyPage);
    expect(globalThis.useMarketingSeo).toHaveBeenCalledWith(
      "Reader — privacy",
      "How Reader handles your data — written to be read, not skimmed past.",
    );
  });

  it("renders the page header", () => {
    const wrapper = shallowMount(PrivacyPage);
    expect(wrapper.find(".page-h1").text()).toBe("Privacy policy.");
  });

  it("renders a table of contents linking each section", () => {
    const wrapper = shallowMount(PrivacyPage);
    const tocLinks = wrapper.findAll(".toc a");
    expect(tocLinks).toHaveLength(8);
    expect(wrapper.find(".toc a[href='#overview']").exists()).toBe(true);
  });

  it("marks the first section active before scrolling", () => {
    const wrapper = shallowMount(PrivacyPage);
    expect(wrapper.find(".toc a[href='#overview']").classes()).toContain(
      "active",
    );
  });

  it("renders a heading for every toc entry", () => {
    const wrapper = shallowMount(PrivacyPage);
    expect(wrapper.findAll(".legal-body h2")).toHaveLength(8);
  });
});
