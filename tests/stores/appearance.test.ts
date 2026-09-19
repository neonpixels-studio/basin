import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { ref, nextTick } from "vue";
import { useAppearanceStore } from "~/stores/appearance";
// @sentry/nuxt is mocked once, globally, in tests/setup.ts — see that file's
// comment for why a module-scoped mock here instead would silently miss the
// calls app/lib/sentry.ts makes.
import * as SentrySDK from "@sentry/nuxt";

// Builds a promise this test controls the resolution/rejection of, so a
// specific loadFromDb() call's `await load()` can be held open while a
// second call (a simulated account switch) runs to completion first.
function deferred<T>() {
  let resolve: (_value: T) => void;
  let reject: (_reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

// Mirrors tests/pages/pricing.test.ts's stubAuth helper, but as mutable refs
// so a single test can drive isLoaded/isSignedIn/userId through an account
// switch (the store's init() watches all three).
function stubAuth() {
  const isLoaded = ref(false);
  const isSignedIn = ref(false);
  const userId = ref<string | null>(null);
  vi.stubGlobal("useAuth", () => ({ isLoaded, isSignedIn, userId }));
  return { isLoaded, isSignedIn, userId };
}

describe("useAppearanceStore loadFromDb ownership guard", () => {
  const userASettings = {
    theme: "dark",
    accentColor: "rose",
    readingFont: "mono",
    spacing: "compact",
    radius: "round",
    autoplayMediaPreviews: true,
    compactNotifications: true,
  };
  const userBSettings = {
    theme: "light",
    accentColor: "blue",
    readingFont: "serif",
    spacing: "roomy",
    radius: "sharp",
    autoplayMediaPreviews: false,
    compactNotifications: false,
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not apply a stale account's settings after switching accounts mid-load", async () => {
    const userALoad = deferred<typeof userASettings>();
    const load = vi
      .fn()
      .mockReturnValueOnce(userALoad.promise)
      .mockResolvedValueOnce(userBSettings);
    const save = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("useUserSettings", () => ({ load, save, error: ref(null) }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();

    // Switch accounts before user A's fetch resolves.
    userId.value = "user-b";
    await nextTick();
    await flushPromises();

    expect(store.state.theme).toBe(userBSettings.theme);
    expect(store.state.accent).toBe(userBSettings.accentColor);

    // User A's stale fetch resolves last — it must not clobber user B's
    // already-applied settings, and must not re-persist them under user B's
    // cache key.
    userALoad.resolve(userASettings);
    await flushPromises();

    expect(store.state.theme).toBe(userBSettings.theme);
    expect(store.state.accent).toBe(userBSettings.accentColor);
    expect(
      JSON.parse(localStorage.getItem("basin-appearance-cache:user-b")!),
    ).toMatchObject({ theme: userBSettings.theme });
    // The security-relevant half of the guard: user A's settings must never
    // reach save() — that would PATCH them onto user B's row under user B's
    // auth token, not just mis-render locally.
    expect(save).not.toHaveBeenCalledWith(
      expect.objectContaining({ theme: userASettings.theme }),
    );
  });

  it("does not clear the current account's loadedUserId claim when a stale load rejects", async () => {
    const userALoad = deferred<typeof userASettings>();
    const load = vi
      .fn()
      .mockReturnValueOnce(userALoad.promise)
      .mockResolvedValueOnce(userBSettings);
    vi.stubGlobal("useUserSettings", () => ({
      load,
      save: vi.fn().mockResolvedValue(undefined),
      error: ref(null),
    }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();

    userId.value = "user-b";
    await nextTick();
    await flushPromises();

    expect(store.state.theme).toBe(userBSettings.theme);

    // User A's stale fetch rejects after user B is already loaded. Before the
    // fix, the catch block unconditionally reset loadedUserId to undefined,
    // which would make init()'s watcher think nobody is loaded and re-fire
    // loadFromDb("user-b") on the next auth re-evaluation even though user B
    // is already loaded.
    userALoad.reject(new Error("stale fetch failed"));
    await flushPromises();

    const loadCallsBeforeRefire = load.mock.calls.length;

    // Re-evaluate auth for the *same* already-loaded user without an actual
    // account switch — e.g. Clerk re-resolving on a token refresh. Toggling
    // isLoaded (rather than userId, which is unchanged) is what re-fires the
    // watcher: init() watches all three of isLoaded/isSignedIn/userId, and
    // Vue's ref setter skips no-op writes, so re-assigning userId to its
    // current value wouldn't trigger the watcher at all.
    isLoaded.value = false;
    await nextTick();
    isLoaded.value = true;
    await nextTick();
    await flushPromises();

    // If the stale rejection had wrongly cleared loadedUserId, this looks
    // like a fresh sign-in for "user-b" to init()'s watcher: another
    // loadFromDb() call (and a spurious reset to DEFAULTS in between).
    expect(load.mock.calls.length).toBe(loadCallsBeforeRefire);
    expect(store.state.theme).toBe(userBSettings.theme);
  });

  it("does not re-apply settings from a signed-out account's stale fetch", async () => {
    const userALoad = deferred<typeof userASettings>();
    const load = vi.fn().mockReturnValueOnce(userALoad.promise);
    const save = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("useUserSettings", () => ({ load, save, error: ref(null) }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();

    // Sign out while user A's fetch is still in flight.
    isSignedIn.value = false;
    userId.value = null;
    await nextTick();

    expect(store.ready).toBe(true);
    expect(store.state.theme).toBe("system");

    // The in-flight fetch lands after sign-out. It must not re-apply user
    // A's settings onto the now-signed-out (default) state, and must not
    // write a cache entry for an account nobody is looking at anymore.
    userALoad.resolve(userASettings);
    await flushPromises();

    expect(store.state.theme).toBe("system");
    expect(localStorage.getItem("basin-appearance-cache:user-a")).toBeNull();
    // No account is signed in, so nothing should ever be PATCHed to the API.
    expect(save).not.toHaveBeenCalled();
  });

  it("does not let a stale fetch flip ready while the current account's load is still pending", async () => {
    const userALoad = deferred<typeof userASettings>();
    const userBLoad = deferred<typeof userBSettings>();
    const load = vi
      .fn()
      .mockReturnValueOnce(userALoad.promise)
      .mockReturnValueOnce(userBLoad.promise);
    vi.stubGlobal("useUserSettings", () => ({
      load,
      save: vi.fn().mockResolvedValue(undefined),
      error: ref(null),
    }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();

    userId.value = "user-b";
    await nextTick();

    expect(store.ready).toBe(false);

    // The stale user A fetch resolves first, while user B's own fetch is
    // still pending — this must not uncloak the UI ahead of user B's real
    // settings landing.
    userALoad.resolve(userASettings);
    await flushPromises();

    expect(store.ready).toBe(false);

    userBLoad.resolve(userBSettings);
    await flushPromises();

    expect(store.ready).toBe(true);
    expect(store.state.theme).toBe(userBSettings.theme);
  });

  it("re-cloaks the UI on an account switch instead of showing the new account's defaults as ready", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(userASettings)
      .mockReturnValueOnce(deferred<typeof userBSettings>().promise);
    vi.stubGlobal("useUserSettings", () => ({
      load,
      save: vi.fn().mockResolvedValue(undefined),
      error: ref(null),
    }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();
    await flushPromises();

    // User A is fully loaded and uncloaked before the switch.
    expect(store.ready).toBe(true);
    expect(store.state.theme).toBe(userASettings.theme);

    // Switching to user B (no cache, fetch still pending) must not leave the
    // UI reporting ready with user A's stale `ready` flag while it renders
    // user B's freshly-reset DEFAULTS as if they were real settings.
    userId.value = "user-b";
    await nextTick();

    expect(store.ready).toBe(false);
    expect(store.state.theme).toBe("system");
  });

  it("does not let a stale fetch from an earlier load of the same account clobber a newer one", async () => {
    // Covers switching A → B → A: the second "user-a" load reuses the same
    // id as the first, so a guard keyed only on `loadedUserId !== userId`
    // would wrongly treat the first load's late resolution as still current.
    const firstUserALoad = deferred<typeof userASettings>();
    const secondUserALoad = deferred<typeof userASettings>();
    const load = vi
      .fn()
      .mockReturnValueOnce(firstUserALoad.promise)
      .mockResolvedValueOnce(userBSettings)
      .mockReturnValueOnce(secondUserALoad.promise);
    vi.stubGlobal("useUserSettings", () => ({
      load,
      save: vi.fn().mockResolvedValue(undefined),
      error: ref(null),
    }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();

    userId.value = "user-b";
    await nextTick();
    await flushPromises();

    userId.value = "user-a";
    await nextTick();

    // A local edit lands while the second "user-a" load is in flight.
    store.state.theme = "light";
    await nextTick();

    // The *first* "user-a" load's fetch resolves last of all, well after the
    // second "user-a" load has started (and the user has edited locally).
    // Its id matches the currently-loaded account, but it is not the current
    // load — it must not overwrite the local edit.
    firstUserALoad.resolve(userASettings);
    await flushPromises();

    expect(store.state.theme).toBe("light");
  });

  it("clears the claim and retries on the next auth change when a non-stale load genuinely fails", async () => {
    const failingLoad = deferred<typeof userASettings>();
    const load = vi
      .fn()
      .mockReturnValueOnce(failingLoad.promise)
      .mockResolvedValueOnce(userASettings);
    vi.stubGlobal("useUserSettings", () => ({
      load,
      save: vi.fn().mockResolvedValue(undefined),
      error: ref(null),
    }));

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();

    // No competing account switch — this load simply fails on its own.
    const loadError = new Error("network error");
    failingLoad.reject(loadError);
    await flushPromises();

    // Every failure path still uncloaks, per loadFromDb()'s own doc comment.
    expect(store.ready).toBe(true);
    expect(SentrySDK.captureException).toHaveBeenCalledWith(loadError);

    // Toggling isLoaded (not userId, which is unchanged) re-fires init()'s
    // watcher for the same account — this only retries if the failed call's
    // catch block actually cleared loadedUserId back to undefined.
    isLoaded.value = false;
    await nextTick();
    isLoaded.value = true;
    await nextTick();
    await flushPromises();

    expect(load).toHaveBeenCalledTimes(2);
    expect(store.state.theme).toBe(userASettings.theme);
  });

  it("still uncloaks and stays retryable when useUserSettings() itself throws", async () => {
    const brokenUseUserSettings = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("called outside a Nuxt context");
      })
      .mockImplementationOnce(() => ({
        load: vi.fn().mockResolvedValue(userASettings),
        save: vi.fn().mockResolvedValue(undefined),
        error: ref(null),
      }));
    vi.stubGlobal("useUserSettings", brokenUseUserSettings);

    const { isLoaded, isSignedIn, userId } = stubAuth();
    const store = useAppearanceStore();
    store.init();

    isLoaded.value = true;
    isSignedIn.value = true;
    userId.value = "user-a";
    await nextTick();
    await flushPromises();

    // A synchronous throw ahead of the DB fetch must still be caught (see
    // the comment on why useUserSettings()/watch() moved inside the try) —
    // otherwise the claim is stuck with no persistence watcher and no retry.
    expect(store.ready).toBe(true);

    isLoaded.value = false;
    await nextTick();
    isLoaded.value = true;
    await nextTick();
    await flushPromises();

    expect(brokenUseUserSettings).toHaveBeenCalledTimes(2);
    expect(store.state.theme).toBe(userASettings.theme);
  });
});
