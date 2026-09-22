import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope } from "vue";
import { useFeeds } from "~/composables/useFeeds";
import { useToast } from "~/composables/useToast";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const { toast } = useToast();

const feedA = {
  id: 1,
  url: "https://a.com/feed.xml",
  title: "Feed A",
  source: "rss",
  sourceOverride: null,
  detectedSource: "rss",
  createdAt: null,
};
const feedB = {
  id: 2,
  url: "https://b.com/feed.xml",
  title: "Feed B",
  source: "rss",
  sourceOverride: null,
  createdAt: null,
};

describe("useFeeds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    toast.msg = "";
    toast.show = false;
  });

  describe("load()", () => {
    it("fetches from /api/feeds and populates items", async () => {
      mockFetch.mockResolvedValue([feedA, feedB]);
      const { items, load } = useFeeds();
      await load();
      expect(items.value).toEqual([feedA, feedB]);
      expect(mockFetch).toHaveBeenCalledWith("/api/feeds", expect.any(Object));
    });

    it("sets error and leaves items empty on failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const { items, error, load } = useFeeds();
      await load();
      expect(error.value).toBeTruthy();
      expect(items.value).toEqual([]);
    });

    it("clears a previous error on successful load", async () => {
      const { error, load } = useFeeds();
      mockFetch.mockRejectedValueOnce(new Error("oops"));
      await load();
      mockFetch.mockResolvedValueOnce([feedA]);
      await load();
      expect(error.value).toBeNull();
    });

    it("passes through syncStatus and syncError from the API response", async () => {
      const failingFeed = {
        ...feedA,
        syncStatus: "error" as const,
        syncError: "Feed unreachable",
      };
      mockFetch.mockResolvedValue([failingFeed]);
      const { items, load } = useFeeds();
      await load();
      expect(items.value[0].syncStatus).toBe("error");
      expect(items.value[0].syncError).toBe("Feed unreachable");
    });
  });

  describe("add()", () => {
    // add() calls discover, then detect. confirmAdd() calls POST /api/feeds.
    // Mock order: 1) load → GET /api/feeds, 2) discover → POST /api/feeds/discover,
    //             3) detect → POST /api/feeds/detect

    it("does nothing when newUrl is empty", async () => {
      mockFetch.mockResolvedValue([]);
      const { load, add } = useFeeds();
      await load();
      await add();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("calls the discover endpoint before detect", async () => {
      mockFetch.mockResolvedValueOnce([feedB]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "rss" }); // detect
      const { newUrl, load, add } = useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/discover",
        expect.objectContaining({
          method: "POST",
          body: { url: "https://a.com" },
        }),
      );
    });

    it("calls the detect endpoint with the discovered URL", async () => {
      mockFetch.mockResolvedValueOnce([feedB]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "podcast" }); // detect
      const { newUrl, load, add } = useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/detect",
        expect.objectContaining({
          method: "POST",
          body: { url: "https://a.com/feed.xml" },
        }),
      );
    });

    it("sets detectedSource and pendingFeedUrl after successful detection", async () => {
      mockFetch.mockResolvedValueOnce([]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "podcast" }); // detect
      const { newUrl, load, add, detectedSource, pendingFeedUrl } = useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      expect(detectedSource.value).toBe("podcast");
      expect(pendingFeedUrl.value).toBe("https://a.com/feed.xml");
    });

    it("sets 'no feed found' error and keeps newUrl when discover returns 422", async () => {
      const notFoundError = Object.assign(new Error("No feed found"), {
        statusCode: 422,
      });
      mockFetch.mockResolvedValueOnce([]); // load
      mockFetch.mockRejectedValueOnce(notFoundError); // discover returns 422
      const { error, newUrl, load, add } = useFeeds();
      await load();
      newUrl.value = "https://not-a-feed-site.com";
      await add();
      expect(error.value).toBe(
        "No feed found at that URL — check the address and try again",
      );
      expect(newUrl.value).toBe("https://not-a-feed-site.com");
    });

    it("sets a generic error and keeps newUrl when discover throws a non-422 error", async () => {
      const networkError = Object.assign(new Error("Network failure"), {
        statusCode: 500,
      });
      mockFetch.mockResolvedValueOnce([]); // load
      mockFetch.mockRejectedValueOnce(networkError); // discover throws non-422
      const { error, newUrl, load, add } = useFeeds();
      await load();
      newUrl.value = "https://example.com";
      await add();
      expect(error.value).toBe(
        "Something went wrong while finding the feed — try again",
      );
      expect(newUrl.value).toBe("https://example.com");
    });
  });

  describe("confirmAdd()", () => {
    it("does nothing when there is no pendingFeedUrl", async () => {
      const { confirmAdd } = useFeeds();
      await confirmAdd();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("posts to /api/feeds with the pending URL and prepends the new feed", async () => {
      mockFetch.mockResolvedValueOnce([feedB]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "rss" }); // detect
      mockFetch.mockResolvedValueOnce(feedA); // confirmAdd
      const { items, newUrl, load, add, confirmAdd } = useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      await confirmAdd();
      expect(items.value[0]).toEqual(feedA);
      expect(items.value).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ url: "https://a.com/feed.xml" }),
        }),
      );
    });

    it("passes sourceOverride to the API when set", async () => {
      mockFetch.mockResolvedValueOnce([]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "rss" }); // detect
      mockFetch.mockResolvedValueOnce(feedA); // confirmAdd
      const { newUrl, load, add, confirmAdd, sourceOverride } = useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      sourceOverride.value = "podcast";
      await confirmAdd();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds",
        expect.objectContaining({
          body: expect.objectContaining({ sourceOverride: "podcast" }),
        }),
      );
    });

    it("clears newUrl, detectedSource, sourceOverride, and pendingFeedUrl after success", async () => {
      mockFetch.mockResolvedValueOnce([]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "rss" }); // detect
      mockFetch.mockResolvedValueOnce(feedA); // confirmAdd
      const {
        newUrl,
        load,
        add,
        confirmAdd,
        detectedSource,
        sourceOverride,
        pendingFeedUrl,
      } = useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      await confirmAdd();
      expect(newUrl.value).toBe("");
      expect(detectedSource.value).toBeNull();
      expect(sourceOverride.value).toBeNull();
      expect(pendingFeedUrl.value).toBeNull();
    });

    it("sets error and keeps state when the POST to /api/feeds fails", async () => {
      mockFetch.mockResolvedValueOnce([]); // load
      mockFetch.mockResolvedValueOnce({ feedUrl: "https://a.com/feed.xml" }); // discover
      mockFetch.mockResolvedValueOnce({ detectedSource: "rss" }); // detect
      mockFetch.mockRejectedValueOnce(new Error("server error")); // confirmAdd fails
      const { error, newUrl, load, add, confirmAdd, pendingFeedUrl } =
        useFeeds();
      await load();
      newUrl.value = "https://a.com";
      await add();
      await confirmAdd();
      expect(error.value).toBeTruthy();
      expect(pendingFeedUrl.value).toBe("https://a.com/feed.xml");
    });
  });

  describe("importOpml()", () => {
    const opmlFile = new File(
      [
        `<opml><body><outline title="Feed A" xmlUrl="https://a.com/feed.xml"/></body></opml>`,
      ],
      "feeds.opml",
      { type: "text/x-opml" },
    );

    it("posts the file content to /api/feeds/import", async () => {
      mockFetch.mockResolvedValueOnce({
        imported: [],
        skipped: [],
        truncatedCount: 0,
      });
      const { importOpml } = useFeeds();
      await importOpml(opmlFile);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/import",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            opml: expect.stringContaining("xmlUrl"),
          }),
        }),
      );
    });

    it("prepends imported feeds to items and records the summary", async () => {
      mockFetch.mockResolvedValueOnce({
        imported: [feedA],
        skipped: [
          { url: "https://bad.com/feed.xml", title: "Bad", reason: "invalid" },
        ],
        truncatedCount: 0,
      });
      const { items, importOpml, importSummary } = useFeeds();
      await importOpml(opmlFile);
      expect(items.value).toEqual([feedA]);
      expect(importSummary.value).toEqual({
        importedCount: 1,
        skipped: [
          { url: "https://bad.com/feed.xml", title: "Bad", reason: "invalid" },
        ],
        truncatedCount: 0,
      });
    });

    it("replaces the existing row instead of duplicating it when a re-imported feed was already subscribed", async () => {
      mockFetch.mockResolvedValueOnce([feedA, feedB]); // load
      mockFetch.mockResolvedValueOnce({
        imported: [{ ...feedA, title: "Feed A (updated)" }],
        skipped: [],
        truncatedCount: 0,
      });
      const { items, load, importOpml } = useFeeds();
      await load();
      await importOpml(opmlFile);

      const idOccurrences = items.value.filter((feed) => feed.id === feedA.id);
      expect(idOccurrences).toHaveLength(1);
      expect(idOccurrences[0].title).toBe("Feed A (updated)");
      expect(items.value).toHaveLength(2);
    });

    it("sets error and leaves importSummary null when the request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("server error"));
      const { error, importSummary, importOpml } = useFeeds();
      await importOpml(opmlFile);
      expect(error.value).toBeTruthy();
      expect(importSummary.value).toBeNull();
    });

    it("toggles importing to true during the request and false after", async () => {
      let resolveFetch: (_value: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );
      const { importing, importOpml } = useFeeds();
      const promise = importOpml(opmlFile);
      expect(importing.value).toBe(true);
      resolveFetch({ imported: [], skipped: [], truncatedCount: 0 });
      await promise;
      expect(importing.value).toBe(false);
    });
  });

  describe("exportOpml()", () => {
    it("fetches /api/feeds/export as text", async () => {
      mockFetch.mockResolvedValueOnce("<opml><body></body></opml>");
      const { exportOpml } = useFeeds();
      await exportOpml();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/export",
        expect.objectContaining({ responseType: "text" }),
      );
    });

    it("sets error when the export request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("server error"));
      const { error, exportOpml } = useFeeds();
      await exportOpml();
      expect(error.value).toBeTruthy();
    });

    it("toggles exporting to true during the request and false after", async () => {
      let resolveFetch: (_value: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );
      const { exporting, exportOpml } = useFeeds();
      const promise = exportOpml();
      expect(exporting.value).toBe(true);
      resolveFetch("<opml><body></body></opml>");
      await promise;
      expect(exporting.value).toBe(false);
    });
  });

  describe("remove()", () => {
    it("optimistically removes the feed from items", async () => {
      mockFetch.mockResolvedValueOnce([feedA, feedB]);
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { items, load, remove } = useFeeds();
      await load();
      await remove(feedA.id);
      expect(items.value).toHaveLength(1);
      expect(items.value[0].id).toBe(feedB.id);
    });

    it("sends DELETE to /api/feeds/:id", async () => {
      mockFetch.mockResolvedValueOnce([feedA]);
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { load, remove } = useFeeds();
      await load();
      await remove(feedA.id);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("restores the feed and sets error when DELETE fails", async () => {
      mockFetch.mockResolvedValueOnce([feedA, feedB]);
      mockFetch.mockRejectedValueOnce(new Error("Server error"));
      const { items, error, load, remove } = useFeeds();
      await load();
      await remove(feedA.id);
      expect(items.value).toHaveLength(2);
      expect(error.value).toBeTruthy();
    });

    it("does nothing when the id is not in the list", async () => {
      mockFetch.mockResolvedValueOnce([feedA]);
      const { items, load, remove } = useFeeds();
      await load();
      await remove(999);
      expect(items.value).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("retryFeed()", () => {
    const failingFeed = {
      ...feedA,
      syncStatus: "error" as const,
      syncError: "Feed unreachable",
      syncFailedAt: "2026-01-01T00:00:00.000Z",
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("does nothing when the feed id is not in items", async () => {
      mockFetch.mockResolvedValueOnce([feedA]); // load
      const { load, retryFeed } = useFeeds();
      await load();
      await retryFeed(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("posts to /api/feeds/:id/retry for a failing feed", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true, eventId: "evt-1" }); // retry POST
      mockFetch.mockResolvedValueOnce([{ ...failingFeed, syncStatus: "ok" }]); // poll load
      const { load, retryFeed } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500);
      await retrying;

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/feeds/${failingFeed.id}/retry`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("marks the feed as retrying while in flight and clears it afterward", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockResolvedValueOnce([{ ...failingFeed, syncStatus: "ok" }]); // poll load
      const { load, retryFeed, isRetrying } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      expect(isRetrying(failingFeed.id)).toBe(true);
      await vi.advanceTimersByTimeAsync(1500);
      await retrying;
      expect(isRetrying(failingFeed.id)).toBe(false);
    });

    it("does not start a second retry while one is already in flight for the same feed", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockResolvedValueOnce([{ ...failingFeed, syncStatus: "ok" }]); // poll load
      const { load, retryFeed } = useFeeds();
      await load();

      const first = retryFeed(failingFeed.id);
      const second = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500);
      await Promise.all([first, second]);

      // load + retry POST + poll load = 3 calls; a second concurrent
      // retryFeed() call for the same id must not add a duplicate POST.
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("shows a success toast and reflects the healthy status in items once the feed syncs", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockResolvedValueOnce([{ ...failingFeed, syncStatus: "ok" }]); // poll load
      const { load, retryFeed, items } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500);
      await retrying;

      expect(toast.msg).toBe("Feed synced successfully");
      expect(items.value[0].syncStatus).toBe("ok");
    });

    it("surfaces the new sync error when the feed fails again", async () => {
      const refailed = {
        ...failingFeed,
        syncError: "Still broken",
        syncFailedAt: "2026-01-01T00:05:00.000Z",
      };
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockResolvedValueOnce([refailed]); // poll load
      const { load, retryFeed } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500);
      await retrying;

      expect(toast.msg).toBe("Still broken");
    });

    it("stops polling after the max attempts and reports the retry is still pending", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      // Every poll keeps returning the same unresolved failure.
      mockFetch.mockResolvedValue([failingFeed]);
      const { load, retryFeed } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500 * 5);
      await retrying;

      expect(toast.msg).toBe(
        "Retry queued — still checking, refresh shortly to see the result",
      );
    });

    it("shows an error toast and clears retrying state when queuing the retry fails", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockRejectedValueOnce(new Error("network down")); // retry POST fails
      const { load, retryFeed, isRetrying } = useFeeds();
      await load();

      await retryFeed(failingFeed.id);

      expect(toast.msg).toBe("Failed to queue retry — try again");
      expect(isRetrying(failingFeed.id)).toBe(false);
    });

    it("does not overwrite the add-feed form's error while polling in the background", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockResolvedValueOnce([{ ...failingFeed, syncStatus: "ok" }]); // poll load
      const { load, retryFeed, error } = useFeeds();
      await load();
      error.value = "Failed to add feed — check the URL and try again";

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500);
      await retrying;

      // The poll uses a silent refetch, not load() — load() clears `error`
      // as a side effect, which would wipe an unrelated add-feed error out
      // from under the user mid-poll.
      expect(error.value).toBe(
        "Failed to add feed — check the URL and try again",
      );
    });

    it("shows a specific message and refreshes when the feed already recovered (409)", async () => {
      const recovered = { ...failingFeed, syncStatus: "ok" as const };
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      const conflict = Object.assign(
        new Error("Feed is not in a failing state"),
        {
          statusCode: 409,
        },
      );
      mockFetch.mockRejectedValueOnce(conflict); // retry POST 409s
      mockFetch.mockResolvedValueOnce([recovered]); // refreshItems after the 409
      const { load, retryFeed, items } = useFeeds();
      await load();

      await retryFeed(failingFeed.id);

      expect(toast.msg).toBe(
        "This feed no longer needs a retry — refreshing its status",
      );
      expect(items.value[0].syncStatus).toBe("ok");
    });

    it("stops polling without a toast when the feed is deleted mid-poll", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockResolvedValueOnce([]); // poll load — feed no longer exists
      const { load, retryFeed, isRetrying } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500);
      await retrying;

      expect(toast.msg).toBe("");
      expect(isRetrying(failingFeed.id)).toBe(false);
    });

    it("keeps polling instead of treating a failed background refresh as resolved", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      mockFetch.mockRejectedValueOnce(new Error("network blip")); // poll refresh #1 fails
      mockFetch.mockResolvedValueOnce([{ ...failingFeed, syncStatus: "ok" }]); // poll refresh #2 succeeds
      const { load, retryFeed } = useFeeds();
      await load();

      const retrying = retryFeed(failingFeed.id);
      await vi.advanceTimersByTimeAsync(1500 * 2);
      await retrying;

      expect(toast.msg).toBe("Feed synced successfully");
    });

    it("stops polling and drops the outcome toast once the owning scope is disposed", async () => {
      mockFetch.mockResolvedValueOnce([failingFeed]); // load
      mockFetch.mockResolvedValueOnce({ queued: true }); // retry POST
      // No further mock is required — the poll must not run once disposed.
      const scope = effectScope();
      const feeds = scope.run(() => useFeeds())!;
      await feeds.load();

      const retrying = feeds.retryFeed(failingFeed.id);
      scope.stop();
      await vi.advanceTimersByTimeAsync(1500 * 5);
      await retrying;

      expect(toast.msg).toBe("");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
