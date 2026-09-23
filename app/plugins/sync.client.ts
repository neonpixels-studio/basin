export default defineNuxtPlugin(() => {
  const { flushSyncQueue } = useSyncQueue();

  // "online" and "visibilitychange" only fire on a *transition* — a tab
  // that boots already online and visible would otherwise never flush a
  // queue left over from a previous offline session until one of those
  // events happens to occur.
  const isVisibleAndOnline = () =>
    navigator.onLine && document.visibilityState === "visible";

  if (isVisibleAndOnline()) {
    flushSyncQueue();
  }

  window.addEventListener("online", () => {
    flushSyncQueue();
  });

  document.addEventListener("visibilitychange", () => {
    if (isVisibleAndOnline()) {
      flushSyncQueue();
    }
  });
});
