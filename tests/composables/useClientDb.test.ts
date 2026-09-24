// Mocks PGlite/drizzle (rather than exercising the real WASM client, as
// syncQueueStore.test.ts does) so this suite can control exactly when
// "opening" resolves and count how many client instances get constructed —
// the thing under test is useClientDb()'s own memoization, not PGlite's
// behavior.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExec = vi.fn().mockResolvedValue(undefined);
// A class, not an arrow function: useClientDb() calls `new PGlite(...)`,
// and only a constructor-shaped mock can stand in for that.
const mockPGlite = vi.fn(function PGlite() {
  return { exec: mockExec };
});

vi.mock("@electric-sql/pglite", () => ({
  PGlite: mockPGlite,
}));

vi.mock("drizzle-orm/pglite", () => ({
  drizzle: vi.fn((client: unknown) => ({ client })),
}));

// Each test needs a fresh copy of the module-level `dbPromise` memo, so the
// module is re-imported (after vi.resetModules()) rather than imported once
// at file scope.
async function importFreshUseClientDb() {
  const module = await import("~/composables/useClientDb");
  return module.useClientDb;
}

describe("useClientDb", () => {
  beforeEach(() => {
    vi.resetModules();
    mockPGlite.mockClear();
    mockExec.mockReset().mockResolvedValue(undefined);
  });

  // This is the boot-flush race: the sync plugin's boot flush and
  // SyncQueueAlert's onMounted both call useClientDb() before either has
  // finished opening. Memoizing the resolved value (not the promise) would
  // let both see nothing yet and each construct their own PGlite against
  // the same IndexedDB store.
  it("constructs exactly one PGlite instance for concurrent callers", async () => {
    const useClientDb = await importFreshUseClientDb();

    const [first, second] = await Promise.all([useClientDb(), useClientDb()]);

    expect(mockPGlite).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("reuses the same instance for a later, sequential call", async () => {
    const useClientDb = await importFreshUseClientDb();

    const first = await useClientDb();
    const second = await useClientDb();

    expect(mockPGlite).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("retries on the next call after the open fails, instead of caching the rejection", async () => {
    const useClientDb = await importFreshUseClientDb();
    mockExec.mockRejectedValueOnce(new Error("IndexedDB blocked"));

    await expect(useClientDb()).rejects.toThrow("IndexedDB blocked");
    const db = await useClientDb();

    expect(db).toBeDefined();
    expect(mockPGlite).toHaveBeenCalledTimes(2);
  });
});
