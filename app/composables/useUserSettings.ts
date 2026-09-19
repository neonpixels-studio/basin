/* useUserSettings — API layer for reading/writing user settings from the
   database. Called by useAppearanceStore and useFeedStore during init. */
import { captureException } from "~/lib/sentry";

export interface UserSettings {
  theme: string;
  accentColor: string;
  readingFont: string;
  spacing: string;
  radius: string;
  layout: string;
  showUnreadOnly: boolean;
  autoplayMediaPreviews: boolean;
  compactNotifications: boolean;
}

export type UserSettingsPatch = Partial<UserSettings>;

export const USER_SETTINGS_DEFAULTS: UserSettings = {
  theme: "system",
  accentColor: "violet",
  readingFont: "serif",
  spacing: "cozy",
  radius: "sharp",
  layout: "timeline",
  showUnreadOnly: false,
  autoplayMediaPreviews: false,
  compactNotifications: false,
};

export function useUserSettings() {
  const { buildAuthHeaders } = useAuthHeaders();
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<UserSettings> {
    loading.value = true;
    error.value = null;
    try {
      const headers = await buildAuthHeaders();
      return await $fetch<UserSettings>("/api/settings/reading", { headers });
    } catch (caughtError) {
      // This is the layer that actually holds the real fetch failure —
      // callers (e.g. useAppearanceStore.loadFromDb) only ever see the
      // static "Failed to load settings" string via `error`, and load()
      // itself never rejects, so this is the only place a real settings-load
      // failure can reach Sentry at all.
      captureException(caughtError, { stage: "user-settings-load" });
      error.value = "Failed to load settings";
      return { ...USER_SETTINGS_DEFAULTS };
    } finally {
      loading.value = false;
    }
  }

  async function save(patch: UserSettingsPatch): Promise<UserSettings | null> {
    error.value = null;
    try {
      const headers = await buildAuthHeaders();
      return await $fetch<UserSettings>("/api/settings/reading", {
        method: "PATCH",
        body: patch,
        headers,
      });
    } catch (caughtError) {
      // Same reasoning as load()'s catch above: this is the only place a
      // real settings-save failure (the caught error, not the generic
      // string callers see via `error`) can reach Sentry.
      captureException(caughtError, { stage: "user-settings-save" });
      error.value = "Failed to save settings";
      return null;
    }
  }

  return { loading, error, load, save };
}
