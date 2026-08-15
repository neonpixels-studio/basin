/* useUserSettings — API layer for reading/writing user settings from the
   database. Called by useAppearanceStore and useFeedStore during init. */

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
    } catch {
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
    } catch {
      error.value = "Failed to save settings";
      return null;
    }
  }

  return { loading, error, load, save };
}
