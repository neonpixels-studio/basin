import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useAppearanceStore, ACCENTS } from "~/stores/appearance";
import { USER_SETTINGS_DEFAULTS } from "~/composables/useUserSettings";

// Deferred promise so a test can control exactly when `load()` resolves,
// letting it inject a local edit while the DB fetch is still in flight.
function createDeferred<T>() {
  let resolve!: (_value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Stubs useAuth/useUserSettings and drives store.init() through the
// "signed-in user, DB fetch in flight" path loadFromDb() implements.
function setupSignedInLoad() {
  const isLoaded = ref(true);
  const isSignedIn = ref(true);
  const userId = ref("user_dirty_flag_test");
  vi.stubGlobal("useAuth", () => ({
    isLoaded,
    isSignedIn,
    userId,
    getToken: { value: vi.fn().mockResolvedValue(null) },
  }));

  const deferredLoad = createDeferred<Record<string, unknown>>();
  const save = vi.fn().mockResolvedValue(null);
  vi.stubGlobal("useUserSettings", () => ({
    loading: ref(false),
    error: ref(null),
    load: vi.fn().mockReturnValue(deferredLoad.promise),
    save,
  }));

  return { deferredLoad, save };
}

describe("useAppearanceStore", () => {
  let store: ReturnType<typeof useAppearanceStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useAppearanceStore();
    // Reset to predictable defaults before each test
    store.state.theme = "system";
    store.state.accent = "violet";
    store.state.reading = "mono";
    store.state.density = "cozy";
    store.state.radius = "sharp";
  });

  describe("themeIcon", () => {
    it("returns monitor for system theme", () => {
      store.state.theme = "system";
      expect(store.themeIcon).toBe("monitor");
    });

    it("returns moon for dark theme", () => {
      store.state.theme = "dark";
      expect(store.themeIcon).toBe("moon");
    });

    it("returns sun for light theme", () => {
      store.state.theme = "light";
      expect(store.themeIcon).toBe("sun");
    });
  });

  describe("cycleTheme", () => {
    it("cycles system → light", () => {
      store.state.theme = "system";
      store.cycleTheme();
      expect(store.state.theme).toBe("light");
    });

    it("cycles light → dark", () => {
      store.state.theme = "light";
      store.cycleTheme();
      expect(store.state.theme).toBe("dark");
    });

    it("cycles dark → system", () => {
      store.state.theme = "dark";
      store.cycleTheme();
      expect(store.state.theme).toBe("system");
    });
  });

  describe("accentList", () => {
    it("includes all ACCENTS keys", () => {
      expect(store.accentList.map((a) => a.key)).toEqual(Object.keys(ACCENTS));
    });

    it("includes the oklch color value for each accent", () => {
      store.accentList.forEach((a) => {
        expect(a.color).toBe(ACCENTS[a.key as keyof typeof ACCENTS].a);
      });
    });
  });

  describe("applyToDom", () => {
    it("does not throw when called", () => {
      expect(() => store.applyToDom()).not.toThrow();
    });
  });

  describe("density", () => {
    const VALID_DENSITIES = ["compact", "cozy", "roomy"];

    it("defaults to cozy", () => {
      setActivePinia(createPinia());
      const freshStore = useAppearanceStore();
      expect(freshStore.state.density).toBe("cozy");
    });

    it.each(VALID_DENSITIES)(
      "accepts '%s' as a valid density value",
      (density) => {
        store.state.density = density;
        expect(store.state.density).toBe(density);
      },
    );
  });

  // Regression coverage for #264: a single boolean dirty flag discarded the
  // *entire* DB response on any in-flight edit (reverting untouched fields),
  // and the persistence watcher — registered before the fetch — re-fired on
  // the DB response applying, PATCHing the just-loaded values straight back.
  describe("loadFromDb (via init())", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      localStorage.clear();
    });

    it("preserves a field edited mid-fetch while still applying untouched fields from the DB response", async () => {
      const { deferredLoad } = setupSignedInLoad();
      const freshStore = useAppearanceStore();
      freshStore.init();
      await flushPromises();

      // Simulate a visitor changing the accent while the DB fetch is still
      // in flight.
      freshStore.state.accent = "teal";
      await flushPromises();

      deferredLoad.resolve({
        ...USER_SETTINGS_DEFAULTS,
        theme: "dark",
        accentColor: "blue",
        readingFont: "mono",
      });
      await flushPromises();

      // The in-flight edit wins for the field the visitor touched...
      expect(freshStore.state.accent).toBe("teal");
      // ...but every untouched field still gets the DB's value, not silently
      // discarded back to whatever the cache/defaults held.
      expect(freshStore.state.theme).toBe("dark");
      expect(freshStore.state.reading).toBe("mono");
    });

    it("does not re-trigger the persistence PATCH when the DB response applies with no local edits", async () => {
      const { deferredLoad, save } = setupSignedInLoad();
      const freshStore = useAppearanceStore();
      freshStore.init();
      await flushPromises();

      expect(save).not.toHaveBeenCalled();

      deferredLoad.resolve({
        ...USER_SETTINGS_DEFAULTS,
        theme: "dark",
        accentColor: "blue",
        readingFont: "mono",
      });
      await flushPromises();

      expect(freshStore.state.theme).toBe("dark");
      // Applying the DB's own values back onto state is not a local edit —
      // it must not PATCH those values straight back to where they came from.
      expect(save).not.toHaveBeenCalled();
    });

    it("only saves the user's own edit, not an echo of the DB response that landed after it", async () => {
      const { deferredLoad, save } = setupSignedInLoad();
      const freshStore = useAppearanceStore();
      freshStore.init();
      await flushPromises();

      freshStore.state.accent = "teal";
      await flushPromises();
      expect(save).toHaveBeenCalledTimes(1);

      deferredLoad.resolve({
        ...USER_SETTINGS_DEFAULTS,
        theme: "dark",
        accentColor: "blue",
        readingFont: "mono",
      });
      await flushPromises();

      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
