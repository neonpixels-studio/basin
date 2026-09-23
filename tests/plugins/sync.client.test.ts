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

// Registers the plugin against a stubbed useSyncQueue() so each test can
// assert on flushSyncQueue in isolation, mirroring the appearance.client
// plugin test's setupPlugin() helper.
function setupPlugin() {
  const flushSyncQueue = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("useSyncQueue", () => ({ flushSyncQueue }));
  syncPlugin();
  return { flushSyncQueue };
}

describe("sync.client plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    stubOnline(true);
  });

  it("flushes the sync queue at boot when the device is already online", () => {
    stubOnline(true);

    const { flushSyncQueue } = setupPlugin();

    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("does not flush at boot when the device is offline", () => {
    stubOnline(false);

    const { flushSyncQueue } = setupPlugin();

    expect(flushSyncQueue).not.toHaveBeenCalled();
  });

  it("still flushes when the browser fires the online event", () => {
    stubOnline(false);
    const { flushSyncQueue } = setupPlugin();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    stubOnline(true);
    window.dispatchEvent(new Event("online"));

    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("still flushes on visibilitychange while online, and only then", () => {
    stubOnline(false);
    const { flushSyncQueue } = setupPlugin();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flushSyncQueue).not.toHaveBeenCalled();

    stubOnline(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });
});
