import { describe, it, expect, vi, beforeEach } from "vitest";
import { useUserSettings } from "~/composables/useUserSettings";
// @sentry/nuxt is mocked once, globally, in tests/setup.ts — see that file's
// comment for why a module-scoped mock here instead would silently miss the
// calls app/lib/sentry.ts makes.
import * as SentrySDK from "@sentry/nuxt";

const mockSettings = {
  theme: "dark",
  accentColor: "teal",
  readingFont: "mono",
  spacing: "compact",
  layout: "grid",
  showUnreadOnly: true,
  autoplayMediaPreviews: false,
  compactNotifications: false,
};

describe("useUserSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("load", () => {
    it("returns fetched settings on success", async () => {
      vi.stubGlobal("$fetch", vi.fn().mockResolvedValue(mockSettings));
      const { load } = useUserSettings();
      const result = await load();
      expect(result).toEqual(mockSettings);
    });

    // Regression (#285): load() used to swallow a fetch failure into a
    // synthetic USER_SETTINGS_DEFAULTS return, making it indistinguishable
    // from the API's own genuine "no settings row yet" response. Callers
    // (useAppearanceStore.loadFromDb) then applied that fallback over a good
    // cached/in-memory snapshot and re-PATCHed it, resetting a real
    // account's settings to defaults. Rethrowing lets a caller tell the two
    // cases apart and preserve whatever it already has on a real failure.
    it("rejects instead of returning defaults when the fetch fails", async () => {
      const fetchError = new Error("Network error");
      vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(fetchError));
      const { load } = useUserSettings();
      // .toBe (not .toThrow), so the rejection is the same error object —
      // load() rethrows the caught fetch error as-is, never wraps it.
      await expect(load()).rejects.toBe(fetchError);
    });

    it("sets loading to true while fetching and false after", async () => {
      let resolvePromise!: (_value: unknown) => void;
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
        ),
      );
      const { load, loading } = useUserSettings();
      const promise = load();
      expect(loading.value).toBe(true);
      resolvePromise(mockSettings);
      await promise;
      expect(loading.value).toBe(false);
    });

    // The success-path test above doesn't exercise the `finally` block on
    // the path that now matters most: load() rethrows on failure (#285), so
    // a regression that moved `loading.value = false` out of `finally` (or
    // dropped it from the throwing branch) would leave a caller's spinner
    // stuck forever after any real fetch failure.
    it("resets loading to false when the fetch fails", async () => {
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      const { load, loading } = useUserSettings();
      await load().catch(() => {});
      expect(loading.value).toBe(false);
    });

    it("sets error on failure", async () => {
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      const { load, error } = useUserSettings();
      await load().catch(() => {});
      expect(error.value).toBe("Failed to load settings");
    });

    it("captures the real fetch error to Sentry before rethrowing — the `error` ref only ever exposes the generic string", async () => {
      const fetchError = new Error("Network error");
      vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(fetchError));
      const { load } = useUserSettings();
      await load().catch(() => {});
      expect(SentrySDK.captureException).toHaveBeenCalledWith(fetchError);
    });

    it("clears error before each fetch", async () => {
      vi.stubGlobal("$fetch", vi.fn().mockResolvedValue(mockSettings));
      const { load, error } = useUserSettings();
      error.value = "old error";
      await load();
      expect(error.value).toBeNull();
    });
  });

  describe("save", () => {
    it("returns updated settings on success", async () => {
      vi.stubGlobal("$fetch", vi.fn().mockResolvedValue(mockSettings));
      const { save } = useUserSettings();
      const result = await save({ theme: "dark" });
      expect(result).toEqual(mockSettings);
    });

    it("returns null when the fetch fails", async () => {
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      const { save } = useUserSettings();
      const result = await save({ theme: "dark" });
      expect(result).toBeNull();
    });

    it("sets error on failure", async () => {
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      const { save, error } = useUserSettings();
      await save({ layout: "grid" });
      expect(error.value).toBe("Failed to save settings");
    });

    it("reports the real fetch failure to Sentry — callers only ever see the generic error string", async () => {
      const fetchError = new Error("Network error");
      vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(fetchError));
      const { save } = useUserSettings();
      await save({ layout: "grid" });
      expect(SentrySDK.captureException).toHaveBeenCalledWith(fetchError);
    });

    it("sends a PATCH request to /api/settings/reading", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockSettings);
      vi.stubGlobal("$fetch", mockFetch);
      const { save } = useUserSettings();
      await save({ theme: "light" });
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/settings/reading",
        expect.objectContaining({ method: "PATCH", body: { theme: "light" } }),
      );
    });

    // Regression: a settings save is often the last thing to happen before
    // a route change (toggle unread-only, then navigate away). Without
    // `keepalive`, the browser aborts any request still in flight when the
    // page that issued it is unloaded, silently dropping that write.
    it("sends the PATCH request with keepalive so it survives a navigation away from the page", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockSettings);
      vi.stubGlobal("$fetch", mockFetch);
      const { save } = useUserSettings();
      await save({ showUnreadOnly: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/settings/reading",
        expect.objectContaining({ keepalive: true }),
      );
    });
  });
});
