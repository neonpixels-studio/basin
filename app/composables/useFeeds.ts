import { onScopeDispose } from "vue";
import { captureException } from "~/lib/sentry";
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
  paused?: boolean;
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

const STATUS_NO_FEED_FOUND = 422;
const STATUS_RETRY_NOT_APPLICABLE = 409;
const STATUS_RETRY_RATE_LIMITED = 429;
const OPML_EXPORT_FILENAME = "feeds.opml";
const OPML_EXPORT_MIME_TYPE = "text/x-opml";

// Shared by every $fetch call site here that needs to branch on the HTTP
// status of a failure (discoverFeedUrl's 422 check, retryFeed's 409 check)
// instead of treating every rejection as the same generic failure.
function extractStatusCode(error: unknown): number | null {
  const hasNumericStatusCode =
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number";

  return hasNumericStatusCode
    ? (error as { statusCode: number }).statusCode
    : null;
}

// A "Retry now" click queues an async, out-of-process resync (see
// server/api/feeds/[id]/retry.post.ts) — there is no synchronous result to
// return. Polling the feed list a bounded number of times gives the row a
// real chance to reflect the outcome without waiting indefinitely: most
// permanent failures (the only kind that reach the "Needs attention" state)
// resolve or re-fail within a few seconds of the adapter running. A retry
// that is still mid-flight when polling gives up is not re-queued
// automatically — the row simply goes back to "Needs attention" and a later
// click (or the next scheduled tick) picks it up again.
const RETRY_POLL_INTERVAL_MS = 1500;
const RETRY_POLL_MAX_ATTEMPTS = 5;
const RETRY_QUEUE_ERROR_MESSAGE = "Failed to queue retry — try again";
const RETRY_RECOVERED_MESSAGE =
  "This feed already recovered — refreshing its status";
const RETRY_PAUSED_MESSAGE =
  "This feed is paused and can't be retried right now";
const RETRY_RATE_LIMITED_MESSAGE =
  "A retry for this feed was already queued a moment ago — hang tight";
const RETRY_STILL_PENDING_MESSAGE =
  "Retry queued — still checking, refresh shortly to see the result";
const RETRY_SUCCESS_MESSAGE = "Feed synced successfully";
const RETRY_FAILED_FALLBACK_MESSAGE = "Retry failed — feed is still erroring";

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
  // Set once this composable instance's owning effect scope tears down (a
  // component unmount in practice). A retry poll can outlive the row that
  // started it if the user navigates away mid-poll; this stops it from
  // surfacing a toast for a screen nobody is looking at anymore.
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

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
      if (extractStatusCode(err) === STATUS_NO_FEED_FOUND) {
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

  function findFeed(id: number): Feed | undefined {
    return items.value.find((item) => item.id === id);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Every retry-flow toast routes through here so a poll that outlives its
  // component (see the `disposed` comment above) drops its message instead
  // of surfacing it for an unmounted row.
  function notifyIfActive(message: string): void {
    if (!disposed) {
      showToast(message);
    }
  }

  // Refetches the feed list and patches only `feedId`'s row into `items`,
  // rather than replacing the array wholesale — a background poll must not
  // clobber a concurrent optimistic edit to some *other* row (e.g. remove()
  // splicing a different feed out right as this resolves with a response
  // snapshotted before that DELETE committed, which would resurrect it).
  // Also never touches `loading`/`error`: unlike load(), this runs silently
  // while a retry poll is in flight and must not clobber the state the
  // add-feed form's error message or the initial-load spinner depend on
  // (both share `error` with load()). A failed refetch is reported to Sentry
  // and reported as "unavailable": the poll loop treats that as inconclusive
  // and just tries again next attempt.
  type FeedRowRefresh = Feed | "deleted" | "unavailable";

  async function refreshFeedRow(feedId: number): Promise<FeedRowRefresh> {
    try {
      const freshFeeds = await $fetch<Feed[]>("/api/feeds", {
        headers: await buildAuthHeaders(),
      });
      const fresh = freshFeeds.find((item) => item.id === feedId);
      if (!fresh) {
        return "deleted";
      }
      items.value = items.value.map((item) =>
        item.id === feedId ? fresh : item,
      );
      return fresh;
    } catch (err) {
      captureException(err, { stage: "feed-retry-poll-refresh" });
      return "unavailable";
    }
  }

  // Reports how this one feed's row looks now, relative to the failure
  // snapshot taken right before the retry was queued.
  type RetryOutcome = "succeeded" | "failed-again" | "unresolved" | "deleted";

  async function checkRetryOutcome(
    feedId: number,
    baselineSyncFailedAt: string | null | undefined,
  ): Promise<RetryOutcome> {
    const refreshed = await refreshFeedRow(feedId);
    if (refreshed === "deleted") {
      return "deleted";
    }
    if (refreshed === "unavailable") {
      return "unresolved";
    }
    if (refreshed.syncStatus !== "error") {
      return "succeeded";
    }
    if (
      refreshed.syncFailedAt &&
      refreshed.syncFailedAt !== baselineSyncFailedAt
    ) {
      return "failed-again";
    }
    return "unresolved";
  }

  // Reports one poll outcome (toast + row state already reflect it via
  // refreshFeedRow()) and says whether polling is done — "unresolved" is the
  // only outcome that lets the loop keep going.
  function reportRetryOutcome(outcome: RetryOutcome, feedId: number): boolean {
    if (outcome === "deleted") {
      return true;
    }
    if (outcome === "succeeded") {
      notifyIfActive(RETRY_SUCCESS_MESSAGE);
      return true;
    }
    if (outcome === "failed-again") {
      notifyIfActive(
        findFeed(feedId)?.syncError ?? RETRY_FAILED_FALLBACK_MESSAGE,
      );
      return true;
    }
    return false;
  }

  // Polls a bounded number of times for the retry to actually land — see the
  // RETRY_POLL_* constants for why this is bounded rather than open-ended.
  async function pollForRetryOutcome(
    feedId: number,
    baselineSyncFailedAt: string | null | undefined,
  ): Promise<void> {
    for (let attempt = 0; attempt < RETRY_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(RETRY_POLL_INTERVAL_MS);
      if (disposed) {
        return;
      }
      const outcome = await checkRetryOutcome(feedId, baselineSyncFailedAt);
      if (reportRetryOutcome(outcome, feedId)) {
        return;
      }
    }
    notifyIfActive(RETRY_STILL_PENDING_MESSAGE);
  }

  // 409 means the row moved on without us (already recovered, or paused
  // mid-click) — refreshing the row and checking which one it actually is
  // now beats guessing from the status code alone. 429 means the server's
  // own cooldown (server/api/feeds/[id]/retry.post.ts) already has a retry
  // queued for this feed from moments ago; nothing to refresh, just wait.
  // Anything else is a genuine failure to queue.
  async function handleRetryQueueFailure(
    id: number,
    err: unknown,
  ): Promise<void> {
    const statusCode = extractStatusCode(err);

    if (statusCode === STATUS_RETRY_RATE_LIMITED) {
      notifyIfActive(RETRY_RATE_LIMITED_MESSAGE);
      return;
    }

    if (statusCode !== STATUS_RETRY_NOT_APPLICABLE) {
      notifyIfActive(RETRY_QUEUE_ERROR_MESSAGE);
      return;
    }

    const refreshed = await refreshFeedRow(id);
    const paused =
      refreshed !== "deleted" &&
      refreshed !== "unavailable" &&
      refreshed.paused;
    notifyIfActive(paused ? RETRY_PAUSED_MESSAGE : RETRY_RECOVERED_MESSAGE);
  }

  async function retryFeed(id: number): Promise<void> {
    const feed = findFeed(id);
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
    } catch (err) {
      await handleRetryQueueFailure(id, err);
    } finally {
      retryingFeedIds.value = retryingFeedIds.value.filter(
        (retryingId) => retryingId !== id,
      );
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
    retryFeed,
    isRetrying,
  };
}
