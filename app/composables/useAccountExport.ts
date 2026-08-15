/* useAccountExport — downloads the full account data export (sources, saved
   items, reading settings, and connected integrations) as a JSON file. The
   OPML export in useFeeds only covers feed URLs; this fulfills the privacy
   page's "download your sources and saved items" promise (app/pages/privacy.vue). */

import { downloadTextFile } from "~/utils/downloadTextFile";

const ACCOUNT_EXPORT_ENDPOINT = "/api/account/export";
const ACCOUNT_EXPORT_FILENAME = "reader-data-export.json";
const ACCOUNT_EXPORT_MIME_TYPE = "application/json";
const JSON_INDENT_SPACES = 2;

export function useAccountExport() {
  const { buildAuthHeaders } = useAuthHeaders();
  const exporting = ref(false);
  const error = ref<string | null>(null);

  async function exportData(): Promise<void> {
    exporting.value = true;
    error.value = null;
    try {
      const data = await $fetch(ACCOUNT_EXPORT_ENDPOINT, {
        headers: await buildAuthHeaders(),
      });
      const json = JSON.stringify(data, null, JSON_INDENT_SPACES);
      downloadTextFile(ACCOUNT_EXPORT_FILENAME, json, ACCOUNT_EXPORT_MIME_TYPE);
    } catch {
      error.value = "Failed to export your data — try again";
    } finally {
      exporting.value = false;
    }
  }

  return { exporting, error, exportData };
}
