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

  // Deferred to the app:mounted hook (not called eagerly at plugin-body
  // time) for the same reason documented on the store's init(): running it
  // before Vue's hydration pass completes can race Nuxt's automatic Pinia
  // state hydration and produce a hydration mismatch. app:mounted fires
  // once the root Vue instance mounts regardless of whether app.vue or
  // error.vue is the component that actually mounted.
  nuxtApp.hook("app:mounted", () => {
    appearanceStore.init();
  });
});
