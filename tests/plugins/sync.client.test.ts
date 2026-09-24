import { describe, it, expect, vi, afterEach } from "vitest";
import syncPlugin from "~/plugins/sync.client";

// Stubs navigator.onLine — it's exposed as a getter with no setter, so a
// direct assignment throws a TypeError in strict mode (this file is an ES
// module, which is always strict); redefining the property is the only way
// a test can control it.
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

// Captures a target's addEventListener calls into `handlers`, keyed by
// "<target>:<type>" — window and document each have their own "online" (in
// principle) and must not overwrite each other's entry in a shared map.
function captureListenersOn(
  target: typeof window | typeof document,
  targetName: string,
  handlers: Record<string, () => void>,
) {
  vi.spyOn(target, "addEventListener").mockImplementation(((
    type: string,
    handler: () => void,
  ) => {
    handlers[`${targetName}:${type}`] = handler;
  }) as typeof target.addEventListener);
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
  captureListenersOn(window, "window", handlers);
  captureListenersOn(document, "document", handlers);

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

  // Matches the existing visibilitychange handler's behavior: defer sync
  // work in a tab the user isn't currently looking at.
  it("does not flush at boot when the tab is hidden", () => {
    stubOnline(true);
    stubVisibility("hidden");

    const { flushSyncQueue } = setupPlugin();

    expect(flushSyncQueue).not.toHaveBeenCalled();
  });

  it("registers 'online' on window and 'visibilitychange' on document", () => {
    const { handlers } = setupPlugin();

    expect(handlers["window:online"]).toBeInstanceOf(Function);
    expect(handlers["document:visibilitychange"]).toBeInstanceOf(Function);
  });

  it("flushes when the browser fires the online event", () => {
    stubOnline(false);
    const { flushSyncQueue, handlers } = setupPlugin();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    stubOnline(true);
    handlers["window:online"]();

    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("flushes on visibilitychange while online, and only then", () => {
    stubOnline(false);
    stubVisibility("hidden");
    const { flushSyncQueue, handlers } = setupPlugin();

    stubVisibility("visible");
    handlers["document:visibilitychange"]();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    stubOnline(true);
    handlers["document:visibilitychange"]();
    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("does not flush on visibilitychange while the tab is hidden", () => {
    stubOnline(true);
    stubVisibility("hidden");
    const { flushSyncQueue, handlers } = setupPlugin();
    expect(flushSyncQueue).not.toHaveBeenCalled();

    handlers["document:visibilitychange"]();

    expect(flushSyncQueue).not.toHaveBeenCalled();
  });
});
