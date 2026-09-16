import { defineStore } from "pinia";
import { reactive, ref, computed, watch, type Ref } from "vue";
import type {
  UserSettings,
  UserSettingsPatch,
} from "~/composables/useUserSettings";

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

  // `loadingStyle` is a local-only preference: applyToDom() never reads it
  // (it isn't a DOM attribute/CSS var like theme/reading/density/radius/
  // accent are) and it's never sent to or read from the DB (see buildPatch
  // below). It was never part of applyDbSettings before this change either,
  // so excluding it from the persisted-key type below changes nothing
  // observable — there's no persistence or DOM side effect tied to it to
  // preserve.
  type PersistedAppearanceKey =
    | "theme"
    | "accent"
    | "reading"
    | "density"
    | "radius"
    | "autoplay"
    | "compactNotif";

  // Maps each persisted local state key to the DB response key it's read
  // from. applyDbSettings loops over this instead of one branch per field,
  // which is what keeps that function's complexity flat as fields are added.
  // Typed against UserSettings (not a bare `string`) so a typo'd or renamed
  // DB column fails to compile instead of silently reading `undefined`.
  const DB_FIELD_KEYS: Record<PersistedAppearanceKey, keyof UserSettings> = {
    theme: "theme",
    accent: "accentColor",
    reading: "readingFont",
    density: "spacing",
    radius: "radius",
    autoplay: "autoplayMediaPreviews",
    compactNotif: "compactNotifications",
  };

  // Reads `dbKey` off an untrusted source (the DB response, or a
  // hand-editable localStorage cache entry) and falls back to `fallback`
  // unless the value's runtime type actually matches — a corrupt cache
  // entry or a stale API response shouldn't be able to write a
  // wrong-shaped value (a string into a boolean field, an object into a
  // string field) straight into `state`.
  function readTypedField(
    source: Record<string, unknown>,
    dbKey: string,
    fallback: string | boolean,
  ): string | boolean {
    const value = source[dbKey];
    if (typeof fallback === "boolean") {
      return typeof value === "boolean" ? value : fallback;
    }
    return typeof value === "string" ? value : fallback;
  }

  // `editedKeys` is per-key rather than a single flag: a visitor who only
  // touched (say) accent while the DB fetch was in flight should still get
  // every *other* field applied from the DB response. Skipping the whole
  // apply on any single edit silently reverts untouched fields to whatever
  // the cache/defaults happened to hold.
  function applyDbSettings(
    dbSettings: Record<string, unknown>,
    editedKeys: ReadonlySet<PersistedAppearanceKey> = new Set(),
  ) {
    const stateRecord = state as unknown as Record<string, unknown>;
    (Object.keys(DB_FIELD_KEYS) as PersistedAppearanceKey[]).forEach((key) => {
      if (editedKeys.has(key)) {
        return;
      }
      stateRecord[key] = readTypedField(
        dbSettings,
        DB_FIELD_KEYS[key],
        DEFAULTS[key],
      );
    });
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

  // Owns everything about watching `state` for local edits and getting them
  // to the server, so loadFromDb() below can stay focused on the
  // cache → fetch → merge sequence. One watcher per field (not a single
  // deep watch over `state`) is what lets a change be attributed to the
  // specific key that changed (recorded in `editedKeys`) instead of only
  // ever knowing "the object as a whole is dirty".
  function startPersistenceWatchers(
    userId: string,
    save: (_patch: UserSettingsPatch) => Promise<UserSettings | null>,
    saveError: Ref<string | null>,
  ) {
    const editedKeys = new Set<PersistedAppearanceKey>();
    let applyingRemote = false;
    // Set once teardownLoadedAccount() calls stop() below, so a persist
    // already queued via schedulePersist() can't fire after the account it
    // was queued for has been torn down — without this, a sign-out (or
    // account switch) landing between an edit and its scheduled microtask
    // would PATCH the old account's state using the new account's token.
    let tornDown = false;

    // save() already swallows its own request error internally (see
    // useUserSettings) and reports it via `saveError` instead of rejecting —
    // caching on every call regardless would make a failed PATCH invisible:
    // the visitor would see the change stick locally, then watch it silently
    // revert on the next load once the DB turns out to still hold the old
    // value.
    async function persist() {
      applyToDom();
      const patch = buildPatch();
      const result = await save(patch);
      if (!result) {
        console.error("Failed to persist appearance settings", saveError.value);
        return;
      }
      writeCachedSettings(userId, patch);
    }

    // Coalesces persist() so a caller that sets several fields in the same
    // synchronous pass (e.g. applying a preset) still produces one PATCH
    // instead of one per field — each watcher below fires with
    // flush: "sync", but deferring the actual persist lets same-tick writes
    // collapse into a single call, same as the old deep watcher's
    // default-flush batching did.
    //
    // A macrotask (setTimeout), not queueMicrotask, is what makes the
    // `tornDown` check above actually reliable: Vue's own watchers (like the
    // auth watcher in init() that drives teardownLoadedAccount()) flush on
    // a microtask too, and a microtask this code schedules synchronously
    // from inside a `flush: "sync"` watcher callback is queued *before*
    // Vue's flush is — so a microtask scheduled here would run, and PATCH,
    // before a same-tick sign-out's watcher ever got a chance to set
    // `tornDown`. A macrotask always runs after the entire microtask queue
    // (including every pending Vue watcher flush) has drained, so
    // `tornDown` is guaranteed to be up to date by the time this fires.
    let persistScheduled = false;
    function schedulePersist() {
      if (persistScheduled) {
        return;
      }
      persistScheduled = true;
      setTimeout(() => {
        persistScheduled = false;
        if (tornDown) {
          return;
        }
        void persist();
      }, 0);
    }

    // Registered before the DB fetch in loadFromDb so a change made during
    // that round-trip is still saved. `flush: "sync"` matters here: the DB
    // response applying to `state` flips `applyingRemote` back to false in
    // a synchronous `finally` right after mutating every field. Vue's
    // default ("pre") flush would defer these callbacks to the next
    // microtask — by which point applyingRemote would already be back to
    // false, and the remote apply would be misattributed as a local edit
    // and re-PATCHed. Only the applyingRemote check and editedKeys
    // bookkeeping need to run synchronously — the actual persist is
    // deferred via schedulePersist() above.
    const stopWatchers = (
      Object.keys(DB_FIELD_KEYS) as PersistedAppearanceKey[]
    ).map((key) =>
      watch(
        () => state[key],
        () => {
          if (applyingRemote) {
            return;
          }
          editedKeys.add(key);
          schedulePersist();
        },
        { flush: "sync" },
      ),
    );

    return {
      editedKeys,
      schedulePersist,
      setApplyingRemote(value: boolean) {
        applyingRemote = value;
      },
      // Lets loadFromDb() recognize its own in-flight `load()` resolving
      // *after* this account has already been torn down (a sign-out or
      // account switch that landed while the fetch was still pending) — so
      // it can discard that stale response instead of writing it into
      // `state` and, via whichever account's watchers are live now, PATCHing
      // it to the server under the wrong account's token.
      get isTornDown() {
        return tornDown;
      },
      stop() {
        tornDown = true;
        stopWatchers.forEach((stop) => stop());
      },
    };
  }

  // Applies a successfully loaded DB response to `state` and reconciles the
  // server if a local edit landed during the fetch. Split out of loadFromDb
  // so that function's own branching stays under the complexity/line
  // thresholds fallow enforces.
  function applyLoadedSettings(
    userId: string,
    dbSettings: Record<string, unknown>,
    persistence: ReturnType<typeof startPersistenceWatchers>,
  ) {
    persistence.setApplyingRemote(true);
    try {
      applyDbSettings(dbSettings, persistence.editedKeys);
      applyToDom();
      writeCachedSettings(userId, buildPatch());
    } finally {
      persistence.setApplyingRemote(false);
    }
    if (persistence.editedKeys.size > 0) {
      // An edit made while the fetch was in flight already PATCHed a full
      // patch built from whatever the *other* fields held at that moment
      // (cache/defaults, not yet the DB's values) — applyDbSettings just
      // merged in the real DB values for those untouched fields, but that
      // correction never reached the server on its own. Persisting once
      // more here reconciles the server with the corrected merged state
      // instead of leaving it holding that stale mid-flight write.
      persistence.schedulePersist();
    }
  }

  // Stops the per-key persistence watchers started by loadFromDb() —
  // captured so a sign-out (or an account switch) mid-session can tear them
  // down instead of leaving them saving one account's in-memory state under
  // the next account's auth token.
  let stopPersisting: (() => void) | null = null;

  // Tracks which account's settings are currently loaded: a user id once
  // loaded, `null` once resolved to "signed out", or `undefined` before
  // Clerk has resolved at all. Distinguishing "resolved to nobody" from
  // "not yet resolved" is what lets the very first anonymous visitor still
  // reach `ready.value = true` below instead of being read as a no-op.
  let loadedUserId: string | null | undefined;

  // Identifies which loadFromDb() call is the current one, so its pending
  // `await load()` can tell a stale continuation apart from a live one.
  // Comparing against loadedUserId alone isn't enough: an A → B → A switch
  // (or a sign-out followed by signing back in as the same account) reuses
  // the same id, so a stale call from the *first* "A" load would pass an
  // id-only check even though a newer "A" load has since taken over.
  // Incremented by every loadFromDb() call and by teardownLoadedAccount(),
  // so a sign-out invalidates an in-flight load too, not just a switch to a
  // different account.
  let loadGeneration = 0;

  function isStaleLoad(generation: number) {
    return generation !== loadGeneration;
  }

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
    const generation = ++loadGeneration;
    loadedUserId = userId;

    const cached = readCachedSettings(userId);
    if (cached) {
      try {
        applyDbSettings(cached);
        applyToDom();
        ready.value = true;
      } catch (error) {
        console.error("Discarding unusable cached appearance settings", error);
        try {
          localStorage.removeItem(cacheKeyFor(userId));
        } catch (removeError) {
          // Same storage-lockdown case readCachedSettings/writeCachedSettings
          // guard against — losing the ability to clear a bad cache entry
          // shouldn't crash loadFromDb before it reaches the DB fetch below.
          console.error(
            "Failed to clear unusable cached appearance settings",
            removeError,
          );
        }
      }
    }

    // Declared ahead of the try so the catch block below can still consult
    // `persistence?.isTornDown` even if useUserSettings() or
    // startPersistenceWatchers() itself is what threw.
    let persistence: ReturnType<typeof startPersistenceWatchers> | undefined;

    try {
      // useUserSettings() and startPersistenceWatchers() live inside this try
      // (not ahead of it) so that a throw from either — not just a rejection
      // of load() itself — still lands in the catch/finally below instead of
      // leaving loadedUserId claimed with no persistence watcher and no way
      // to retry.
      const { load, save, error: saveError } = useUserSettings();
      persistence = startPersistenceWatchers(userId, save, saveError);
      stopPersisting = persistence.stop;

      const dbSettings = await load();
      if (persistence.isTornDown) {
        // This account was torn down (sign-out or account switch) while
        // load() was still in flight. loadFromDb() for whichever account is
        // actually loaded now already owns `state` and `stopPersisting` —
        // applying this stale response would write a no-longer-loaded
        // account's DB values into the *new* account's shared `state`, and
        // that account's own (live) watchers would treat it as a local edit
        // and PATCH it to the server under the new account's token.
        return;
      }
      applyLoadedSettings(userId, dbSettings, persistence);
    } catch (error) {
      // useUserSettings().load() already falls back to defaults internally
      // and shouldn't reject — this only guards against a future change (or
      // an unexpected throw) leaving the cloak stuck down. Clear the claim so
      // a later auth re-fire retries instead of assuming this account is
      // already loaded — but only if this account is still the loaded one:
      // if it was already torn down (see the isTornDown check above), a
      // newer account may have claimed `loadedUserId` since, and clobbering
      // that claim would make the auth watcher re-run teardown for an
      // account that's already loaded.
      if (!persistence?.isTornDown) {
        console.error("Failed to load appearance settings", error);
        loadedUserId = undefined;
      }
    } finally {
      // A stale continuation skips this too: flipping `ready` here would be
      // this call declaring the load done on the current generation's
      // behalf while its own fetch is still pending. That load's own
      // finally is what owns setting ready once it actually lands.
      if (!isStaleLoad(generation)) {
        ready.value = true;
      }
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
    // Invalidates any loadFromDb() call still in flight for the account being
    // torn down, even if the next thing loaded turns out to be that same
    // account again (see loadGeneration's comment) — a sign-out must retire
    // the outgoing load's claim just as surely as a switch to someone else.
    loadGeneration += 1;
    // Re-cloaks the UI for whatever comes next: without this, a mid-session
    // switch away from an already-loaded (ready === true) account would
    // render the DEFAULTS this function is about to apply as if they were
    // the incoming account's real settings, instead of staying cloaked until
    // that account's own cache hit or fetch lands.
    ready.value = false;
    stopPersisting?.();
    stopPersisting = null;
    loadedUserId = null;
    Object.assign(state, DEFAULTS);
    applyToDom();
  }

  // Called from app/plugins/appearance.client.ts on the app:suspense:resolve
  // hook (inside nuxtApp.runWithContext, which useAuth() below needs — see
  // that plugin's comment), not eagerly here at store-setup time: store
  // setup runs synchronously during SSR/hydration render, which is always
  // default appearance server-side (Clerk auth is client-only). Applying
  // loadFromDb() in that same synchronous pass either races Nuxt's
  // automatic Pinia state hydration (which then reverts the just-applied
  // values back to server defaults, and the persistence watcher below
  // re-PATCHes that revert to the DB) or produces a Vue hydration mismatch
  // that Vue leaves unpatched. Waiting for app:suspense:resolve avoids
  // both: hydration has already settled by then, so this lands as an
  // ordinary post-hydration update — and it fires regardless of whether
  // app.vue or error.vue is the component that resolved inside it.
  //
  // Guarded for re-entrancy in case the call site ever changes — the store
  // itself is a singleton, so this only needs to succeed once.
  let initialized = false;

  function init() {
    if (initialized || !import.meta.client) {
      return;
    }
    initialized = true;

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
    init,
  };
});
