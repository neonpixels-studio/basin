import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import PrivacyPage from "~/pages/privacy.vue";

describe("privacy page (/privacy)", () => {
  beforeEach(() => {
    vi.mocked(globalThis.useSeoMeta).mockClear();
    vi.mocked(globalThis.useHead).mockClear();
    vi.stubGlobal("useRoute", () => ({
      path: "/privacy",
      params: {},
      query: {},
    }));
  });

  it("emits og/twitter meta anchored to the configured site URL", () => {
    shallowMount(PrivacyPage);
    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reader — privacy",
        ogTitle: "Reader — privacy",
        ogType: "website",
        ogUrl: "https://basin.example/privacy",
        ogSiteName: "Reader",
        twitterCard: "summary",
        twitterTitle: "Reader — privacy",
      }),
    );
  });

  it("emits a canonical link anchored to the configured site URL", () => {
    shallowMount(PrivacyPage);
    expect(globalThis.useHead).toHaveBeenCalledWith(
      expect.objectContaining({
        link: [{ rel: "canonical", href: "https://basin.example/privacy" }],
      }),
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
