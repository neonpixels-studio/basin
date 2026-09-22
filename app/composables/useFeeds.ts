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
  syncFailedAt?: string | null;
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

// A "Retry now" click queues an async, out-of-process resync (see
// server/api/feeds/[id]/retry.post.ts) — there is no synchronous result to
// return. Polling the feed list a bounded number of times gives the row a
// real chance to reflect the outcome without waiting indefinitely: most
// permanent failures (the only kind that reach the "Needs attention" state)
// resolve or re-fail within a few seconds of the adapter running.
const RETRY_POLL_INTERVAL_MS = 1500;
const RETRY_POLL_MAX_ATTEMPTS = 5;
const RETRY_QUEUE_ERROR_MESSAGE = "Failed to queue retry — try again";
const RETRY_STILL_PENDING_MESSAGE =
  "Retry queued — still checking, refresh shortly to see the result";
const RETRY_SUCCESS_MESSAGE = "Feed synced successfully";

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
  // Feed ids with a "Retry now" click currently in flight — a row checks
  // membership here to show its own spinner instead of a single global flag,
  // since more than one failing feed can be retried at once.
  const retryingFeedIds = ref<number[]>([]);

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

  function isRetrying(id: number): boolean {
    return retryingFeedIds.value.includes(id);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Re-reads the feed list and reports how this one feed's row looks now,
  // relative to the failure snapshot taken right before the retry was queued.
  type RetryOutcome = "succeeded" | "failed-again" | "unresolved" | "deleted";

  async function checkRetryOutcome(
    feedId: number,
    baselineSyncFailedAt: string | null | undefined,
  ): Promise<RetryOutcome> {
    await load();
    const feed = items.value.find((item) => item.id === feedId);
    if (!feed) {
      return "deleted";
    }
    if (feed.syncStatus !== "error") {
      return "succeeded";
    }
    if (feed.syncFailedAt && feed.syncFailedAt !== baselineSyncFailedAt) {
      return "failed-again";
    }
    return "unresolved";
  }

  // Polls a bounded number of times for the retry to actually land — see the
  // RETRY_POLL_* constants for why this is bounded rather than open-ended.
  async function pollForRetryOutcome(
    feedId: number,
    baselineSyncFailedAt: string | null | undefined,
  ): Promise<void> {
    for (let attempt = 0; attempt < RETRY_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(RETRY_POLL_INTERVAL_MS);
      const outcome = await checkRetryOutcome(feedId, baselineSyncFailedAt);

      if (outcome === "deleted") {
        return;
      }
      if (outcome === "succeeded") {
        showToast(RETRY_SUCCESS_MESSAGE);
        return;
      }
      if (outcome === "failed-again") {
        const feed = items.value.find((item) => item.id === feedId);
        showToast(feed?.syncError ?? "Retry failed — feed is still erroring");
        return;
      }
    }
    showToast(RETRY_STILL_PENDING_MESSAGE);
  }

  async function retryFeed(id: number): Promise<void> {
    const feed = items.value.find((item) => item.id === id);
    if (!feed || isRetrying(id)) {
      return;
    }

    const baselineSyncFailedAt = feed.syncFailedAt;
    retryingFeedIds.value.push(id);
    try {
      await $fetch(`/api/feeds/${id}/retry`, {
        method: "POST",
        headers: await buildAuthHeaders(),
      });
      await pollForRetryOutcome(id, baselineSyncFailedAt);
    } catch {
      showToast(RETRY_QUEUE_ERROR_MESSAGE);
    } finally {
      const index = retryingFeedIds.value.indexOf(id);
      if (index !== -1) {
        retryingFeedIds.value.splice(index, 1);
      }
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
    retryingFeedIds,
    load,
    add,
    confirmAdd,
    remove,
    importOpml,
    exportOpml,
    retryFeed,
    isRetrying,
  };
}
