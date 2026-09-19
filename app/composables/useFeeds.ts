import { downloadTextFile } from "~/utils/downloadTextFile";

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  source: string;
  sourceOverride: "rss" | "podcast" | null;
  detectedSource?: "rss" | "podcast";
  createdAt: string | null;
  syncStatus?: "ok" | "error";
  syncError?: string | null;
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

const STATUS_NO_FEED_FOUND = 422;
const OPML_EXPORT_FILENAME = "feeds.opml";
const OPML_EXPORT_MIME_TYPE = "text/x-opml";

export interface OpmlSkippedFeed {
  url: string;
  title: string | null;
  reason: string;
}

interface OpmlImportResult {
  imported: Feed[];
  skipped: OpmlSkippedFeed[];
  truncatedCount: number;
}

export interface OpmlImportSummary {
  importedCount: number;
  skipped: OpmlSkippedFeed[];
  truncatedCount: number;
}

export function useFeeds() {
  const { buildAuthHeaders } = useAuthHeaders();
  const { showToast } = useToast();

  const items = ref<Feed[]>([]);
  const newUrl = ref("");
  const loading = ref(false);
  const isAdding = ref(false);
  const discovering = ref(false);
  const detecting = ref(false);
  const error = ref<string | null>(null);
  const detectedSource = ref<"rss" | "podcast" | null>(null);
  const sourceOverride = ref<"rss" | "podcast" | null>(null);
  const pendingFeedUrl = ref<string | null>(null);
  const importing = ref(false);
  const exporting = ref(false);
  const importSummary = ref<OpmlImportSummary | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await $fetch<Feed[]>("/api/feeds", {
        headers: await buildAuthHeaders(),
      });
    } catch {
      error.value = "Failed to load feeds";
    } finally {
      loading.value = false;
    }
  }

  async function discoverFeedUrl(rawUrl: string): Promise<string | null> {
    const headers = await buildAuthHeaders();
    try {
      const result = await $fetch<{ feedUrl: string }>("/api/feeds/discover", {
        method: "POST",
        body: { url: rawUrl },
        headers,
      });
      return result.feedUrl;
    } catch (err: unknown) {
      const statusCode =
        err instanceof Error &&
        "statusCode" in err &&
        typeof (err as { statusCode: unknown }).statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : null;

      if (statusCode === STATUS_NO_FEED_FOUND) {
        return null;
      }

      throw new DiscoveryError(
        err instanceof Error ? err.message : "Discovery request failed",
      );
    }
  }

  async function detectSourceType(resolvedUrl: string): Promise<void> {
    detecting.value = true;
    detectedSource.value = null;
    sourceOverride.value = null;
    try {
      const result = await $fetch<{ detectedSource: "rss" | "podcast" }>(
        "/api/feeds/detect",
        {
          method: "POST",
          body: { url: resolvedUrl },
          headers: await buildAuthHeaders(),
        },
      );
      detectedSource.value = result.detectedSource;
      pendingFeedUrl.value = resolvedUrl;
    } catch {
      error.value =
        "Could not determine feed type — check the URL and try again";
    } finally {
      detecting.value = false;
    }
  }

  async function confirmAdd() {
    const resolvedUrl = pendingFeedUrl.value;
    if (!resolvedUrl) {
      return;
    }

    isAdding.value = true;
    try {
      const feed = await $fetch<Feed>("/api/feeds", {
        method: "POST",
        body: {
          url: resolvedUrl,
          sourceOverride: sourceOverride.value ?? undefined,
        },
        headers: await buildAuthHeaders(),
      });
      items.value.unshift(feed);
      newUrl.value = "";
      pendingFeedUrl.value = null;
      detectedSource.value = null;
      sourceOverride.value = null;
    } catch {
      error.value = "Failed to add feed — check the URL and try again";
    } finally {
      isAdding.value = false;
    }
  }

  async function add() {
    const rawUrl = newUrl.value.trim();
    if (!rawUrl) {
      return;
    }

    error.value = null;
    discovering.value = true;

    try {
      const resolvedUrl = await discoverFeedUrl(rawUrl);
      discovering.value = false;

      if (!resolvedUrl) {
        error.value =
          "No feed found at that URL — check the address and try again";
        return;
      }

      await detectSourceType(resolvedUrl);
    } catch {
      discovering.value = false;
      error.value = "Something went wrong while finding the feed — try again";
    }
  }

  // A feed already subscribed to comes back from the server as the existing
  // row (createFeedForUser upserts on userId+url), so re-importing an OPML
  // that includes it must replace that row in place rather than unshift a
  // second copy with the same id — that would duplicate the :key in the list.
  function mergeImportedFeeds(imported: Feed[]): void {
    const importedById = new Map(imported.map((feed) => [feed.id, feed]));
    items.value = items.value.filter((feed) => !importedById.has(feed.id));
    items.value.unshift(...imported);
  }

  async function importOpml(file: File): Promise<void> {
    importing.value = true;
    error.value = null;
    importSummary.value = null;

    try {
      const opmlText = await file.text();
      const result = await $fetch<OpmlImportResult>("/api/feeds/import", {
        method: "POST",
        body: { opml: opmlText },
        headers: await buildAuthHeaders(),
      });

      mergeImportedFeeds(result.imported);
      importSummary.value = {
        importedCount: result.imported.length,
        skipped: result.skipped,
        truncatedCount: result.truncatedCount,
      };
      showToast(
        `Imported ${result.imported.length} feed${result.imported.length === 1 ? "" : "s"}` +
          (result.skipped.length ? `, ${result.skipped.length} skipped` : "") +
          (result.truncatedCount
            ? `, ${result.truncatedCount} not attempted (file too large)`
            : ""),
      );
    } catch {
      error.value = "Failed to import OPML file — check the file and try again";
    } finally {
      importing.value = false;
    }
  }

  async function exportOpml(): Promise<void> {
    exporting.value = true;
    error.value = null;

    try {
      const opmlText = await $fetch<string>("/api/feeds/export", {
        headers: await buildAuthHeaders(),
        responseType: "text",
      });
      downloadTextFile(OPML_EXPORT_FILENAME, opmlText, OPML_EXPORT_MIME_TYPE);
    } catch {
      error.value = "Failed to export feeds — try again";
    } finally {
      exporting.value = false;
    }
  }

  async function remove(id: number) {
    const index = items.value.findIndex((feed) => feed.id === id);
    if (index === -1) {
      return;
    }
    const [removed] = items.value.splice(index, 1);
    error.value = null;
    try {
      await $fetch(`/api/feeds/${id}`, {
        method: "DELETE",
        headers: await buildAuthHeaders(),
      });
    } catch {
      items.value.splice(index, 0, removed);
      error.value = "Failed to remove feed";
    }
  }

  return {
    items,
    newUrl,
    loading,
    isAdding,
    discovering,
    detecting,
    error,
    detectedSource,
    sourceOverride,
    pendingFeedUrl,
    importing,
    exporting,
    importSummary,
    load,
    add,
    confirmAdd,
    remove,
    importOpml,
    exportOpml,
  };
}
