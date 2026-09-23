import { describe, it, expect, vi, afterEach } from "vitest";
import syncPlugin from "~/plugins/sync.client";

// Stubs navigator.onLine — happy-dom defines it as a plain readonly
// property, not a getter, so a direct assignment silently no-ops instead
// of throwing; redefining it is the only way a test can control it.
function stubOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
  });
}

// Same problem, same fix, for document.visibilityState.
function stubVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value,
    configurable: true,
  });
}

// Registers the plugin against a stubbed useSyncQueue() so each test can
// assert on flushSyncQueue in isolation, mirroring the appearance.client
// plugin test's setupPlugin() helper. Captures the "online"/"visibilitychange"
// listeners instead of registering them for real: dispatching a real event
// on the shared window/document would also re-trigger every other test's
// still-attached listener (the plugin never removes them), making the suite
// order-dependent.
function setupPlugin() {
  const flushSyncQueue = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("useSyncQueue", () => ({ flushSyncQueue }));

  const handlers: Record<string, () => void> = {};
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    handler: () => void,
  ) => {
    handlers[type] = handler;
  }) as typeof window.addEventListener);
  vi.spyOn(document, "addEventListener").mockImplementation(((
    type: string,
    handler: () => void,
  ) => {
    handlers[type] = handler;
  }) as typeof document.addEventListener);

  syncPlugin();
  return { flushSyncQueue, handlers };
}

describe("sync.client plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    stubOnline(true);
    stubVisibility("visible");
  });

  it("flushes the sync queue at boot when the device is already online and visible", () => {
    stubOnline(true);
    stubVisibility("visible");

    const { flushSyncQueue } = setupPlugin();

    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("does not flush at boot when the device is offline", () => {
    stubOnline(false);
    stubVisibility("visible");

    const { flushSyncQueue } = setupPlugin();

    expect(flushSyncQueue).not.toHaveBeenCalled();
  });

  // A session restore can reopen several tabs in the background at once —
  // each boots against the same shared IndexedDB queue, so a hidden tab
  // must not flush until it's actually the one the user is looking at.
  it("does not flush at boot when the tab is hidden", () => {
    stubOnline(true);
    stubVisibility("hidden");

    const { flushSyncQueue } = setupPlugin();

    expect(flushSyncQueue).not.toHaveBeenCalled();
  });

  it("flushes when the browser fires the online event", () => {
    stubOnline(false);
    const { flushSyncQueue, handlers } = setupPlugin();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    stubOnline(true);
    handlers.online();

    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("flushes on visibilitychange while online, and only then", () => {
    stubOnline(false);
    stubVisibility("hidden");
    const { flushSyncQueue, handlers } = setupPlugin();

    stubVisibility("visible");
    handlers.visibilitychange();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    stubOnline(true);
    handlers.visibilitychange();
    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("does not flush on visibilitychange while the tab is hidden", () => {
    stubOnline(true);
    stubVisibility("hidden");
    const { flushSyncQueue, handlers } = setupPlugin();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    handlers.visibilitychange();

    expect(flushSyncQueue).not.toHaveBeenCalled();
  });
});
