// Applies the visitor's saved appearance (theme, accent, density, ...) to
// <html> on every client boot, including a cold fatal-error load. On a
// fatal/500 Nuxt swaps in error.vue instead of app.vue as the rendered
// child, so app.vue's onMounted (and any init() called from it) never runs
// — the error page would otherwise always render unthemed. A plugin runs as
// part of the nuxtApp instance itself regardless of which component ends up
// mounted, so registering the init call here (instead of in app.vue) is
// what makes error.vue themed too.
export default defineNuxtPlugin((nuxtApp) => {
  const appearanceStore = useAppearanceStore();

  // Deferred to app:suspense:resolve (not app:mounted, and not called
  // eagerly at plugin-body time) for the same reason documented on the
  // store's init(): running it before Vue's hydration pass has settled can
  // race Nuxt's automatic Pinia state hydration and produce a hydration
  // mismatch. app:mounted fires as soon as vueApp.mount() returns, which is
  // before the root Suspense boundary (and therefore hydration) resolves —
  // app:suspense:resolve is what Nuxt's own onNuxtReady waits on for that
  // reason (see node_modules/nuxt/dist/app/composables/ready.js). It fires
  // once regardless of whether app.vue or error.vue is the component that
  // resolved inside it, which is what makes error.vue themed too.
  //
  // Client-side hook callbacks run with no Vue injection context (Nuxt only
  // wraps callHook in runWithContext on the server — see
  // node_modules/nuxt/dist/app/nuxt.js's `if (import.meta.server)` branch),
  // so init()'s call to useAuth() would otherwise hit Clerk's inject() with
  // nothing provided and throw. runWithContext delegates to Vue's
  // app.runWithContext, which restores that injection context.
  nuxtApp.hooks.hookOnce("app:suspense:resolve", () => {
    nuxtApp.runWithContext(() => appearanceStore.init());
  });
});
