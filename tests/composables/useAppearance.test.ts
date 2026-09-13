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

  // Returned so a test can drive a sign-out by flipping these after init()
  // — mutating the same refs useAuth() handed the store's internal watch,
  // rather than re-stubbing useAuth (init() only reads it once).
  return { deferredLoad, save, isSignedIn, userId };
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
      store.init();
      await flushPromises();

      // Simulate a visitor changing the accent while the DB fetch is still
      // in flight.
      store.state.accent = "teal";
      await flushPromises();

      deferredLoad.resolve({
        ...USER_SETTINGS_DEFAULTS,
        theme: "dark",
        accentColor: "blue",
        readingFont: "mono",
      });
      await flushPromises();

      // The in-flight edit wins for the field the visitor touched...
      expect(store.state.accent).toBe("teal");
      // ...but every untouched field still gets the DB's value, not silently
      // discarded back to whatever the cache/defaults held.
      expect(store.state.theme).toBe("dark");
      expect(store.state.reading).toBe("mono");
    });

    it("does not re-trigger the persistence PATCH when the DB response applies with no local edits", async () => {
      const { deferredLoad, save } = setupSignedInLoad();
      store.init();
      await flushPromises();

      expect(save).not.toHaveBeenCalled();

      deferredLoad.resolve({
        ...USER_SETTINGS_DEFAULTS,
        theme: "dark",
        accentColor: "blue",
        readingFont: "mono",
      });
      await flushPromises();

      expect(store.state.theme).toBe("dark");
      // Applying the DB's own values back onto state is not a local edit —
      // it must not PATCH those values straight back to where they came from.
      expect(save).not.toHaveBeenCalled();
    });

    it("reconciles the server with the merged state after an in-flight edit, instead of leaving the server holding the stale mid-flight patch", async () => {
      const { deferredLoad, save } = setupSignedInLoad();
      store.init();
      await flushPromises();

      store.state.accent = "teal";
      await flushPromises();
      expect(save).toHaveBeenCalledTimes(1);
      // This mid-flight patch only knows the edit — every other field is
      // still whatever cache/defaults held, not yet the DB's true values.
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ accentColor: "teal", theme: "system" }),
      );

      deferredLoad.resolve({
        ...USER_SETTINGS_DEFAULTS,
        theme: "dark",
        accentColor: "blue",
        readingFont: "mono",
      });
      // Two flushes: the DB response's continuation (which schedules the
      // reconciling persist as a macrotask) and the scheduled persist itself
      // each need their own turn.
      await flushPromises();
      await flushPromises();

      // A second save reconciles the server with the corrected merged
      // state — this is not the remote-apply watcher re-firing (that's
      // covered by the "does not re-trigger" test above); it's a deliberate
      // follow-up so the server stops holding the stale first PATCH.
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ accentColor: "teal", theme: "dark" }),
      );
    });

    it("keeps persisting normally once the DB response has fully settled", async () => {
      const { deferredLoad, save } = setupSignedInLoad();
      store.init();
      await flushPromises();
      deferredLoad.resolve({ ...USER_SETTINGS_DEFAULTS });
      await flushPromises();
      save.mockClear();

      store.state.accent = "rose";
      await flushPromises();

      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ accentColor: "rose" }),
      );
    });

    it("cancels a persist queued moments before sign-out, instead of PATCHing the old account's state under the new account's token", async () => {
      const { deferredLoad, save, isSignedIn, userId } = setupSignedInLoad();
      store.init();
      await flushPromises();
      deferredLoad.resolve({ ...USER_SETTINGS_DEFAULTS });
      await flushPromises();
      save.mockClear();

      // Edit and sign-out land in the same synchronous pass — schedulePersist()
      // has queued a macrotask, and teardownLoadedAccount() (fired by the auth
      // watcher, also within this same pass) must mark it cancelled before
      // that macrotask gets a turn to run.
      store.state.accent = "teal";
      isSignedIn.value = false;
      userId.value = null;
      await flushPromises();

      expect(save).not.toHaveBeenCalled();
    });

    it("stops every per-key watcher on sign-out, not just one, so a post-sign-out edit never saves under the old account", async () => {
      const { deferredLoad, save, isSignedIn, userId } = setupSignedInLoad();
      store.init();
      await flushPromises();
      deferredLoad.resolve({ ...USER_SETTINGS_DEFAULTS });
      await flushPromises();
      save.mockClear();

      // Drive the same auth refs init()'s watcher is already watching —
      // this is what fires teardownLoadedAccount(), which stops every
      // per-key persistence watcher before resetting state to defaults.
      isSignedIn.value = false;
      userId.value = null;
      await flushPromises();

      (
        [
          "theme",
          "accent",
          "reading",
          "density",
          "radius",
          "autoplay",
          "compactNotif",
        ] as const
      ).forEach((key) => {
        store.state[key] =
          typeof store.state[key] === "boolean" ? true : "changed";
      });
      await flushPromises();

      expect(save).not.toHaveBeenCalled();
    });
  });
});
