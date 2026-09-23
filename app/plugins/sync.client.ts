export default defineNuxtPlugin(() => {
  const { flushSyncQueue } = useSyncQueue();

  // A tab opened while the device is already online never fires "online"
  // or "visibilitychange" — those only fire on a *transition*. Without this,
  // items queued during a previous offline session sit stuck until one of
  // those events happens to fire, undermining the offline-first guarantee.
  // Gated the same way the visibilitychange handler below is (onLine AND
  // visible): a session restore can reopen several hidden tabs against the
  // same IndexedDB queue at once, and flushInFlight only dedupes within a
  // single tab, not across them — a hidden tab will still get its flush
  // once it becomes visible. The onLine check is also belt-and-braces —
  // runFlushPass() already no-ops when offline — kept here so this guard
  // stays symmetric with the visibilitychange one below.
  if (navigator.onLine && document.visibilityState === "visible") {
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
