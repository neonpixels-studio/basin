export default defineNuxtPlugin(() => {
  const { flushSyncQueue } = useSyncQueue();

  // A tab opened while the device is already online never fires "online"
  // or "visibilitychange" — those only fire on a *transition*. Without this,
  // items queued during a previous offline session sit stuck until one of
  // those events happens to fire, undermining the offline-first guarantee.
  if (navigator.onLine) {
    flushSyncQueue();
  }

  window.addEventListener("online", () => {
    flushSyncQueue();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      flushSyncQueue();
    }
  });
});
