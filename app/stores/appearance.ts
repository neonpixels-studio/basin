import { defineStore } from "pinia";
import { reactive, ref, computed, watch } from "vue";

// Caches the last-applied appearance settings client-side so a returning,
// signed-in visitor can uncloak immediately instead of waiting on the
// /api/settings/reading round-trip. The DB fetch in loadFromDb() still runs
// and corrects any drift (e.g. a change made on another device) — this is
// only a first-paint shortcut, not a replacement for the DB as source of
// truth. localStorage (not a cookie) because nothing server-side ever reads
// this — it's a purely client-side cache, so there's no reason to attach it
// to every request the browser makes to the origin. Keyed by Clerk user id
// so a shared/multi-account browser can never read back a different
// account's cached theme.
const APPEARANCE_CACHE_PREFIX = "basin-appearance-cache";

function cacheKeyFor(userId: string): string {
  return `${APPEARANCE_CACHE_PREFIX}:${userId}`;
}

function readCachedSettings(userId: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(cacheKeyFor(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    // Safari private browsing (and similar storage lockdowns) can throw on
    // access itself, not just on a malformed value — either way, a cache
    // miss is the safe fallback, not a crash.
    console.error("Failed to read cached appearance settings", error);
    return null;
  }
}

function writeCachedSettings(userId: string, patch: Record<string, unknown>) {
  try {
    localStorage.setItem(cacheKeyFor(userId), JSON.stringify(patch));
  } catch (error) {
    // Best-effort cache — a full quota or blocked storage shouldn't break
    // the app, just leave the next load to fall back to the DB fetch.
    console.error("Failed to cache appearance settings", error);
  }
}

export const ACCENTS = {
  violet: { a: "oklch(0.6 0.17 285)", s: "oklch(0.54 0.18 285)" },
  blue: { a: "oklch(0.62 0.15 245)", s: "oklch(0.56 0.16 245)" },
  teal: { a: "oklch(0.64 0.11 195)", s: "oklch(0.58 0.12 195)" },
  amber: { a: "oklch(0.71 0.13 72)", s: "oklch(0.65 0.14 72)" },
  rose: { a: "oklch(0.63 0.18 14)", s: "oklch(0.57 0.19 14)" },
};

const DEFAULTS = {
  theme: "system" as string, // system | light | dark
  accent: "violet" as string, // key of ACCENTS
  reading: "serif" as string, // mono | serif
  density: "cozy" as string, // compact | cozy | roomy
  radius: "sharp" as string, // sharp | default | round
  loadingStyle: "both" as string, // skeleton | fade | both
  autoplay: false,
  compactNotif: false,
};

export const useAppearanceStore = defineStore("appearance", () => {
  const state = reactive({ ...DEFAULTS });
  const ready = ref(false);

  function applyToDom() {
    if (!import.meta.client) return;
    const root = document.documentElement;

    if (state.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", state.theme);

    root.setAttribute("data-reading", state.reading);
    root.setAttribute("data-density", state.density);
    root.setAttribute("data-radius", state.radius);

    const accentColors =
      ACCENTS[state.accent as keyof typeof ACCENTS] || ACCENTS.violet;
    root.style.setProperty("--accent", accentColors.a);
    root.style.setProperty("--accent-strong", accentColors.s);
    root.style.setProperty(
      "--accent-soft",
      `color-mix(in oklab, ${accentColors.a} 16%, var(--surface))`,
    );
    root.style.setProperty("--accent-soft-ink", accentColors.a);
  }

  function applyDbSettings(dbSettings: Record<string, unknown>) {
    state.theme = (dbSettings.theme as string) ?? DEFAULTS.theme;
    state.accent = (dbSettings.accentColor as string) ?? DEFAULTS.accent;
    state.reading = (dbSettings.readingFont as string) ?? DEFAULTS.reading;
    state.density = (dbSettings.spacing as string) ?? DEFAULTS.density;
    state.radius = (dbSettings.radius as string) ?? DEFAULTS.radius;
    state.autoplay =
      (dbSettings.autoplayMediaPreviews as boolean) ?? DEFAULTS.autoplay;
    state.compactNotif =
      (dbSettings.compactNotifications as boolean) ?? DEFAULTS.compactNotif;
  }

  function buildPatch() {
    return {
      theme: state.theme,
      accentColor: state.accent,
      readingFont: state.reading,
      spacing: state.density,
      radius: state.radius,
      autoplayMediaPreviews: state.autoplay,
      compactNotifications: state.compactNotif,
    };
  }

  // Stops the deep persistence watcher started by loadFromDb() — captured so
  // a sign-out (or an account switch) mid-session can tear it down instead
  // of leaving it saving one account's in-memory state under the next
  // account's auth token.
  let stopPersisting: (() => void) | null = null;

  // Tracks which account's settings are currently loaded: a user id once
  // loaded, `null` once resolved to "signed out", or `undefined` before
  // Clerk has resolved at all. Distinguishing "resolved to nobody" from
  // "not yet resolved" is what lets the very first anonymous visitor still
  // reach `ready.value = true` below instead of being read as a no-op.
  let loadedUserId: string | null | undefined;

  // Does the real work of loading `userId`'s settings: applies any cached
  // snapshot immediately (so the cloak can lift before the network
  // round-trip resolves), registers the persistence watcher up front — so a
  // change made during that round-trip is saved instead of silently
  // overwritten when the fetch lands — then fetches the DB copy as the
  // source of truth. Never rejects: every failure path still uncloaks and
  // leaves the store retryable on the next auth change. Only ever called
  // right after teardownLoadedAccount(), so there's no previous account's
  // state left to guard against here.
  async function loadFromDb(userId: string) {
    loadedUserId = userId;

    const cached = readCachedSettings(userId);
    if (cached) {
      try {
        applyDbSettings(cached);
        applyToDom();
        ready.value = true;
      } catch (error) {
        console.error("Discarding unusable cached appearance settings", error);
        localStorage.removeItem(cacheKeyFor(userId));
      }
    }

    const { load, save } = useUserSettings();

    // Flips once the visitor changes a setting locally. Registered before
    // the DB fetch below so that edit is saved rather than being clobbered
    // when the fetch resolves and would otherwise re-apply the stale value.
    let dirty = false;
    stopPersisting = watch(
      state,
      () => {
        dirty = true;
        applyToDom();
        const patch = buildPatch();
        save(patch);
        writeCachedSettings(userId, patch);
      },
      { deep: true },
    );

    try {
      const dbSettings = await load();
      if (!dirty) {
        applyDbSettings(dbSettings);
        applyToDom();
        writeCachedSettings(userId, buildPatch());
      }
    } catch (error) {
      // useUserSettings().load() already falls back to defaults internally
      // and shouldn't reject — this only guards against a future change (or
      // an unexpected throw) leaving the cloak stuck down. Clear the claim so
      // a later auth re-fire retries instead of assuming this account is
      // already loaded.
      console.error("Failed to load appearance settings", error);
      loadedUserId = undefined;
    } finally {
      ready.value = true;
    }
  }

  // Tears down whichever account's settings are currently loaded: stops the
  // persistence watcher and drops back to defaults. Used both for a genuine
  // sign-out and as the first step of an account switch (Clerk's account
  // switcher can move between accounts while isSignedIn stays true
  // throughout — only userId changes). Always clearing the previous
  // account's watcher before a new one is registered is what stops the new
  // account's first edit from saving the old account's in-memory theme
  // under the new account's auth token.
  function teardownLoadedAccount() {
    stopPersisting?.();
    stopPersisting = null;
    loadedUserId = null;
    Object.assign(state, DEFAULTS);
    applyToDom();
  }

  function init() {
    if (!import.meta.client) {
      return;
    }

    const { isSignedIn, isLoaded, userId } = useAuth();

    // isSignedIn and userId both read falsy until Clerk finishes its async
    // init (isLoaded flips true), even for an already-authenticated visitor
    // — waiting for isLoaded is what tells "genuinely signed out" apart from
    // "Clerk just hasn't resolved yet" (see the isLoaded comments in
    // pricing.vue/index.vue for the same race). Watching `userId` too (not
    // just isSignedIn) catches it settling a tick after isLoaded/isSignedIn,
    // and catches a Clerk account switch, where isSignedIn never toggles but
    // userId changes. `immediate: true` runs this once loaded resolves for
    // the first time, then again for any later auth change within the same
    // SPA session — the store is a singleton created once, so without this
    // a mid-session auth change would never be noticed.
    watch(
      [isLoaded, isSignedIn, userId],
      ([loaded, signedIn, currentUserId]) => {
        if (!loaded) {
          return;
        }
        const nextUserId = signedIn ? currentUserId : null;
        if (nextUserId === loadedUserId) {
          // Already loaded (or already resolved to signed-out) — nothing to do.
          return;
        }
        teardownLoadedAccount();
        if (nextUserId) {
          loadFromDb(nextUserId);
          return;
        }
        ready.value = true;
      },
      { immediate: true },
    );
  }

  // Auto-initialize when the store is first used.
  init();

  const accentList = computed(() =>
    Object.keys(ACCENTS).map((k) => ({
      key: k,
      color: ACCENTS[k as keyof typeof ACCENTS].a,
    })),
  );

  // Computed so the template uses `themeIcon` without calling it as a function.
  const themeIcon = computed(() =>
    state.theme === "dark"
      ? "moon"
      : state.theme === "light"
        ? "sun"
        : "monitor",
  );

  function cycleTheme() {
    const order = ["system", "light", "dark"];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
  }

  return {
    state,
    ready,
    ACCENTS,
    accentList,
    themeIcon,
    cycleTheme,
    applyToDom,
  };
});
