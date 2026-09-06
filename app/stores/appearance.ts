import { defineStore } from "pinia";
import { reactive, ref, computed, watch } from "vue";

// Caches the last-applied appearance settings client-side so a returning,
// signed-in visitor can uncloak immediately instead of waiting on the
// /api/settings/reading round-trip. The DB fetch in init() still runs and
// corrects any drift (e.g. a change made on another device) — this is only
// a first-paint shortcut, not a replacement for the DB as source of truth.
// localStorage (not a cookie) because nothing server-side ever reads this —
// it's a purely client-side cache, so there's no reason to attach it to
// every request the browser makes to the origin.
const APPEARANCE_CACHE_KEY = "basin-appearance-cache";

function readCachedSettings(): Record<string, unknown> | null {
  const raw = localStorage.getItem(APPEARANCE_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedSettings(patch: Record<string, unknown>) {
  localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(patch));
}

function clearCachedSettings() {
  localStorage.removeItem(APPEARANCE_CACHE_KEY);
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

  // Does the real work of loading this visitor's settings: applies any
  // cached snapshot immediately (so the cloak can lift before the network
  // round-trip resolves), then fetches the DB copy as the source of truth
  // and starts persisting further changes. Guarded by `initialized` so the
  // reveal-after-Clerk-loads case and an actual sign-in can't both trigger it.
  async function loadFromDb() {
    if (initialized) return;
    initialized = true;

    const cached = readCachedSettings();
    if (cached) {
      applyDbSettings(cached);
      applyToDom();
      ready.value = true;
    }

    const { load, save } = useUserSettings();
    const dbSettings = await load();
    applyDbSettings(dbSettings);
    applyToDom();
    writeCachedSettings(buildPatch());
    ready.value = true;

    watch(
      state,
      () => {
        applyToDom();
        const patch = buildPatch();
        save(patch);
        writeCachedSettings(patch);
      },
      { deep: true },
    );
  }

  async function init() {
    if (!import.meta.client) return;

    const { isSignedIn } = useAuth();

    // isSignedIn reads falsy until Clerk finishes its async init (isLoaded
    // flips true), even for an already-authenticated visitor — this watcher
    // is what catches that reveal, plus an actual sign-in later in the same
    // SPA session. The store is a singleton created once per session, so
    // without this a mid-session login would never be noticed: the visitor
    // would be stuck on default theming with their changes never saved
    // until a full reload. Signing out clears the cache so a later sign-in
    // (same tab, same browser) doesn't briefly paint the previous account's
    // theme from a stale cached snapshot.
    watch(isSignedIn, (signedIn) => {
      if (signedIn) loadFromDb();
      else clearCachedSettings();
    });

    if (isSignedIn.value) {
      await loadFromDb();
      return;
    }

    // Not signed in (yet, at least) — there's no authenticated settings to
    // fetch right now, so don't fire a request that would only 401 back to
    // defaults. Uncloak immediately; the watcher above takes over the
    // moment sign-in state resolves to true.
    ready.value = true;
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
