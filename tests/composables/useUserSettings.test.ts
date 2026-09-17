import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useUserSettings,
  USER_SETTINGS_DEFAULTS,
} from "~/composables/useUserSettings";
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

    it("returns defaults when the fetch fails", async () => {
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      const { load } = useUserSettings();
      const result = await load();
      expect(result).toEqual(USER_SETTINGS_DEFAULTS);
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

    it("sets error on failure", async () => {
      vi.stubGlobal(
        "$fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      const { load, error } = useUserSettings();
      await load();
      expect(error.value).toBe("Failed to load settings");
    });

    it("reports the real fetch failure to Sentry — load() itself never rejects, so this is the only place it's visible", async () => {
      const fetchError = new Error("Network error");
      vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(fetchError));
      const { load } = useUserSettings();
      await load();
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
  });
});
