import { describe, it, expect, vi, afterEach } from "vitest";
import appearancePlugin from "~/plugins/appearance.client";

// Fakes the subset of nuxtApp the plugin uses: capture whatever callback is
// registered via hookOnce for a given hook name so the test can fire it
// manually, mirroring how Nuxt itself would invoke it once the root
// Suspense boundary resolves.
function fakeNuxtApp() {
  const handlers: Record<string, () => void> = {};
  return {
    hooks: {
      hookOnce: vi.fn((name: string, handler: () => void) => {
        handlers[name] = handler;
      }),
    },
    fireHook(name: string) {
      handlers[name]?.();
    },
  };
}

describe("appearance.client plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call appearanceStore.init() before app:suspense:resolve fires", () => {
    const init = vi.fn();
    vi.stubGlobal("useAppearanceStore", () => ({ init }));
    const nuxtApp = fakeNuxtApp();

    appearancePlugin(nuxtApp);

    expect(init).not.toHaveBeenCalled();
  });

  // This is what makes error.vue themed on a cold fatal load:
  // app:suspense:resolve fires once the root Suspense boundary resolves
  // regardless of whether app.vue or error.vue ended up as the rendered
  // child, unlike app.vue's own onMounted, which only fires when app.vue
  // itself mounts.
  it("calls appearanceStore.init() once app:suspense:resolve fires", () => {
    const init = vi.fn();
    vi.stubGlobal("useAppearanceStore", () => ({ init }));
    const nuxtApp = fakeNuxtApp();

    appearancePlugin(nuxtApp);
    nuxtApp.fireHook("app:suspense:resolve");

    expect(init).toHaveBeenCalledTimes(1);
  });

  it("registers with hookOnce, not hook, so a later clearError()-driven resolve can't re-init", () => {
    const init = vi.fn();
    vi.stubGlobal("useAppearanceStore", () => ({ init }));
    const nuxtApp = fakeNuxtApp();

    appearancePlugin(nuxtApp);

    expect(nuxtApp.hooks.hookOnce).toHaveBeenCalledWith(
      "app:suspense:resolve",
      expect.any(Function),
    );
  });
});
