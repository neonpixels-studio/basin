import { describe, it, expect, vi, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import App from "~/app.vue";

function stubRoute(path: string) {
  vi.stubGlobal("useRoute", () => ({ path, params: {}, query: {} }));
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the root div", () => {
    const wrapper = shallowMount(App);
    expect(wrapper.find("div").exists()).toBe(true);
  });

  it("includes overlay components", () => {
    const wrapper = shallowMount(App);
    const html = wrapper.html();
    expect(html).toContain("search-overlay-stub");
    expect(html).toContain("reader-detail-stub");
    expect(html).toContain("app-toast-stub");
    expect(html).toContain("sync-queue-alert-stub");
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(App);
    expect(wrapper.html()).toMatchSnapshot();
  });

  describe("first-paint cloak", () => {
    it("is not cloaked on the public index route before settings load", () => {
      stubRoute("/");
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    it("is not cloaked on marketing routes before settings load", () => {
      stubRoute("/pricing");
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    it("is not cloaked on /login before settings load", () => {
      stubRoute("/login");
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    it("stays cloaked on an authenticated route until settings resolve", () => {
      stubRoute("/dashboard");
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).not.toContain("app-ready");
    });
  });
});
