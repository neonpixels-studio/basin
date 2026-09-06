import { defineStore } from "pinia";
import { reactive, ref, computed, watch } from "vue";
import { isUnauthenticatedRoute } from "~/utils/publicPaths";

// Caches the last-applied appearance settings client-side so a returning,
// signed-in visitor can uncloak immediately instead of waiting on the
// /api/settings/reading round-trip. The DB fetch in init() still runs and
// corrects any drift (e.g. a change made on another device) — this is only
// a first-paint shortcut, not a replacement for the DB as source of truth.
const APPEARANCE_CACHE_COOKIE = "basin-appearance-cache";
const APPEARANCE_CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

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

  async function init() {
    if (initialized || !import.meta.client) return;
    initialized = true;

    const route = useRoute();
    if (isUnauthenticatedRoute(route.path)) {
      // Marketing pages and /login never have authenticated settings to
      // load — skip the DB round-trip entirely (it would only 401 back to
      // defaults) and uncloak immediately. app.vue independently skips the
      // opacity cloak for these same routes, so this just saves the
      // wasted fetch.
      ready.value = true;
      return;
    }

    const cache = useCookie<Record<string, unknown> | null>(
      APPEARANCE_CACHE_COOKIE,
      {
        default: () => null,
        maxAge: APPEARANCE_CACHE_MAX_AGE_SECONDS,
        sameSite: "lax",
      },
    );

    if (cache.value) {
      applyDbSettings(cache.value);
      applyToDom();
      ready.value = true;
    }

    const { load, save } = useUserSettings();
    const dbSettings = await load();
    applyDbSettings(dbSettings);
    applyToDom();
    cache.value = buildPatch();
    ready.value = true;

    watch(
      state,
      () => {
        applyToDom();
        const patch = buildPatch();
        save(patch);
        cache.value = patch;
      },
      { deep: true },
    );
  }

  // Auto-initialize when the store is first used — the guard inside prevents
  // double-runs within the same Pinia instance.
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
