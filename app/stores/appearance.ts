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
  let initialized = false;

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
  // a sign-out mid-session can tear it down (see resetForSignedOut) instead
  // of leaving it saving one account's in-memory state under the next
  // account's auth token.
  let stopPersisting: (() => void) | null = null;

  // Does the real work of loading this visitor's settings: applies any
  // cached snapshot immediately (so the cloak can lift before the network
  // round-trip resolves), then fetches the DB copy as the source of truth
  // and starts persisting further changes. Guarded by `initialized` so a
  // rapid isLoaded/isSignedIn re-fire can't start this twice.
  async function loadFromDb(userId: string) {
    if (initialized) {
      return;
    }
    initialized = true;

    const cached = readCachedSettings(userId);
    if (cached) {
      applyDbSettings(cached);
      applyToDom();
      ready.value = true;
    }

    const { load, save } = useUserSettings();
    try {
      const dbSettings = await load();
      applyDbSettings(dbSettings);
      applyToDom();
      writeCachedSettings(userId, buildPatch());
    } catch (error) {
      // useUserSettings().load() already falls back to defaults internally
      // and shouldn't reject — this only guards against a future change (or
      // an unexpected throw) leaving the cloak stuck down and the persistence
      // watcher below never registered.
      console.error("Failed to load appearance settings", error);
    } finally {
      ready.value = true;
    }

    stopPersisting = watch(
      state,
      () => {
        applyToDom();
        const patch = buildPatch();
        save(patch);
        writeCachedSettings(userId, patch);
      },
      { deep: true },
    );
  }

  // Signing out (or never having been signed in) means there's no
  // authenticated settings to load — stop persisting whatever the previous
  // account had loaded, drop back to defaults, and uncloak immediately
  // rather than firing a fetch that would only 401. Without the teardown, a
  // sign-out-then-sign-in-as-a-different-user in the same tab would leave
  // `initialized` stuck true (so the new account's settings never load) and
  // the old watcher live (so the new account's next change would save the
  // *old* account's in-memory theme under the new account's auth token).
  function resetForSignedOut() {
    stopPersisting?.();
    stopPersisting = null;
    initialized = false;
    Object.assign(state, DEFAULTS);
    applyToDom();
    ready.value = true;
  }

  async function init() {
    if (!import.meta.client) {
      return;
    }

    const { isSignedIn, isLoaded, userId } = useAuth();

    // Both isSignedIn and userId read falsy until Clerk finishes its async
    // init (isLoaded flips true), even for an already-authenticated visitor
    // — waiting for isLoaded is what tells "genuinely signed out" apart from
    // "Clerk just hasn't resolved yet" (see the isLoaded comments in
    // pricing.vue/index.vue for the same race). `immediate: true` runs this
    // once loaded resolves for the first time, then again for any later
    // sign-in/sign-out within the same SPA session — the store is a
    // singleton created once, so without this a mid-session auth change
    // would never be noticed.
    watch(
      [isLoaded, isSignedIn],
      ([loaded, signedIn]) => {
        if (!loaded) {
          return;
        }
        if (signedIn && userId.value) {
          loadFromDb(userId.value);
          return;
        }
        resetForSignedOut();
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
