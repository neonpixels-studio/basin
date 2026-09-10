import { describe, it, expect, vi, afterEach } from "vitest";
import appearancePlugin from "~/plugins/appearance.client";

// Fakes the subset of nuxtApp the plugin uses: capture whatever callback is
// registered for a given hook name so the test can fire it manually,
// mirroring how Nuxt itself would invoke it once the root component mounts.
function fakeNuxtApp() {
  const handlers: Record<string, () => void> = {};
  return {
    hook: vi.fn((name: string, handler: () => void) => {
      handlers[name] = handler;
    }),
    fireHook(name: string) {
      handlers[name]?.();
    },
  };
}

describe("appearance.client plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call appearanceStore.init() before app:mounted fires", () => {
    const init = vi.fn();
    vi.stubGlobal("useAppearanceStore", () => ({ init }));
    const nuxtApp = fakeNuxtApp();

    appearancePlugin(nuxtApp);

    expect(init).not.toHaveBeenCalled();
  });

  // This is what makes error.vue themed on a cold fatal load: app:mounted
  // fires once the root Vue instance mounts regardless of whether app.vue
  // or error.vue ended up as the rendered child, unlike app.vue's own
  // onMounted, which only fires when app.vue itself mounts.
  it("calls appearanceStore.init() once app:mounted fires", () => {
    const init = vi.fn();
    vi.stubGlobal("useAppearanceStore", () => ({ init }));
    const nuxtApp = fakeNuxtApp();

    appearancePlugin(nuxtApp);
    nuxtApp.fireHook("app:mounted");

    expect(init).toHaveBeenCalledTimes(1);
  });
});
