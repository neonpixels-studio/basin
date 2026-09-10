import { describe, it, expect, vi, afterEach } from "vitest";
import appearancePlugin from "~/plugins/appearance.client";

// Fakes the subset of nuxtApp the plugin uses: hookOnce captures whatever
// callback is registered for a given hook name so the test can fire it
// manually (mirroring how Nuxt itself would invoke it once the root
// Suspense boundary resolves), and runWithContext tracks whether the
// wrapped callback actually ran inside it — the plugin needs that context
// for useAuth()'s inject() call to succeed (see the plugin's own comment).
function fakeNuxtApp() {
  const handlers: Record<string, () => void> = {};
  let insideContext = false;
  return {
    hooks: {
      hookOnce: vi.fn((name: string, handler: () => void) => {
        handlers[name] = handler;
      }),
    },
    runWithContext: vi.fn((callback: () => void) => {
      insideContext = true;
      try {
        return callback();
      } finally {
        insideContext = false;
      }
    }),
    fireHook(name: string) {
      handlers[name]?.();
    },
    wasInsideContext() {
      return insideContext;
    },
  };
}

// Shared setup for every test below: stub useAppearanceStore with a
// spyable init(), register the plugin against a fake nuxtApp, and hand
// back both so the test can fire hooks and assert on init().
function setupPlugin() {
  const init = vi.fn();
  vi.stubGlobal("useAppearanceStore", () => ({ init }));
  const nuxtApp = fakeNuxtApp();
  appearancePlugin(nuxtApp);
  return { init, nuxtApp };
}

describe("appearance.client plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call appearanceStore.init() before app:suspense:resolve fires", () => {
    const { init } = setupPlugin();

    expect(init).not.toHaveBeenCalled();
  });

  // This is what makes error.vue themed on a cold fatal load:
  // app:suspense:resolve fires once the root Suspense boundary resolves
  // regardless of whether app.vue or error.vue ended up as the rendered
  // child, unlike app.vue's own onMounted, which only fires when app.vue
  // itself mounts.
  it("calls appearanceStore.init() once app:suspense:resolve fires", () => {
    const { init, nuxtApp } = setupPlugin();

    nuxtApp.fireHook("app:suspense:resolve");

    expect(init).toHaveBeenCalledTimes(1);
  });

  it("registers the resolve callback with hookOnce, not hook", () => {
    const { nuxtApp } = setupPlugin();

    expect(nuxtApp.hooks.hookOnce).toHaveBeenCalledWith(
      "app:suspense:resolve",
      expect.any(Function),
    );
  });

  // Client-side Nuxt hook callbacks run with no Vue injection context by
  // default, which would make init()'s useAuth() call throw inside Clerk's
  // inject() — this is the actual bug the round-2 review caught. Asserting
  // init() runs inside runWithContext is what pins the fix in place.
  it("calls appearanceStore.init() inside runWithContext", () => {
    const { init, nuxtApp } = setupPlugin();
    init.mockImplementation(() => {
      expect(nuxtApp.wasInsideContext()).toBe(true);
    });

    nuxtApp.fireHook("app:suspense:resolve");

    expect(nuxtApp.runWithContext).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });
});
