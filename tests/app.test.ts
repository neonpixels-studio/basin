import { describe, it, expect, vi, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import App from "~/app.vue";

function stubRoute(path: string) {
  vi.stubGlobal("useRoute", () => ({ path, params: {}, query: {} }));
}

// app.vue reads `appearanceStore.ready` in its template and calls
// `appearanceStore.init()` from onMounted — stubbing both lets the "does the
// cloak lift" tests assert against a controlled `ready` value instead of the
// real store's actual (async, DB-fetch-driven) readiness, which this test
// file has no reliable way to drive to `true` on demand, while still giving
// onMounted's `init()` call something to invoke (and letting callers assert
// it was actually called). A plain boolean (not a ref) for `ready` is
// enough: `appearanceStore` here is an ordinary object, not a Pinia store
// proxy, so a nested ref wouldn't auto-unwrap in the template and would read
// as an always-truthy object instead of its `.value`.
function stubAppearanceReady(ready: boolean) {
  const init = vi.fn();
  vi.stubGlobal("useAppearanceStore", () => ({ ready, init }));
  return init;
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the root div", () => {
    stubRoute("/");
    const wrapper = shallowMount(App);
    expect(wrapper.find("div").exists()).toBe(true);
  });

  it("includes overlay components", () => {
    stubRoute("/");
    const wrapper = shallowMount(App);
    const html = wrapper.html();
    expect(html).toContain("search-overlay-stub");
    expect(html).toContain("reader-detail-stub");
    expect(html).toContain("app-toast-stub");
    expect(html).toContain("sync-queue-alert-stub");
  });

  it("matches snapshot", () => {
    stubRoute("/");
    const wrapper = shallowMount(App);
    expect(wrapper.html()).toMatchSnapshot();
  });

  describe("first-paint cloak", () => {
    it("is not cloaked on the public index route even while settings are unready", () => {
      stubRoute("/");
      stubAppearanceReady(false);
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    it("is not cloaked on marketing routes even while settings are unready", () => {
      stubRoute("/pricing");
      stubAppearanceReady(false);
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    it("is not cloaked on /login even while settings are unready", () => {
      stubRoute("/login");
      stubAppearanceReady(false);
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    it("stays cloaked on an authenticated route while settings are unready", () => {
      stubRoute("/dashboard");
      stubAppearanceReady(false);
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).not.toContain("app-ready");
    });

    it("uncloaks an authenticated route once settings become ready", () => {
      stubRoute("/dashboard");
      stubAppearanceReady(true);
      const wrapper = shallowMount(App);
      expect(wrapper.find(".app-shell").classes()).toContain("app-ready");
    });

    // appearanceStore.init() must run post-mount (not eagerly at store-setup
    // time) so its cache/DB apply can't race Nuxt's SSR state hydration —
    // see the store's init() for why. This guards against that call being
    // dropped from onMounted, which would leave settings never loading at
    // all while every other test here still passed.
    it("calls appearanceStore.init() on mount", () => {
      stubRoute("/dashboard");
      const init = stubAppearanceReady(false);
      shallowMount(App);
      expect(init).toHaveBeenCalledTimes(1);
    });
  });
});
