import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useFeedStore, FEED_SYNC_TIMEOUT_MS } from "~/stores/feed";
import { makeFeed, makeConnection } from "../fixtures";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: Math.floor(Math.random() * 1e9),
  feedId: 10,
  guid: "test-guid-1",
  type: "article",
  source: "Test",
  handle: "test.com",
  title: "Test Item",
  excerpt: "Excerpt.",
  time: "1h",
  meta: "3 min",
  tags: [],
  unread: true,
  saved: false,
  starred: false,
  ...overrides,
});

describe("useFeedStore", () => {
  let feed: ReturnType<typeof useFeedStore>;
  let state: ReturnType<typeof useFeedStore>["state"];

  beforeEach(() => {
    setActivePinia(createPinia());
    feed = useFeedStore();
    state = feed.state;
    vi.useFakeTimers();
    state.items = [
      item({ id: 1, type: "article", unread: true, saved: false }),
      item({ id: 2, type: "video", unread: false, saved: true }),
      item({ id: 3, type: "podcast", unread: true, saved: false }),
      item({ id: 4, type: "tweet", unread: false, saved: false }),
    ];
    state.filter = "all";
    state.unreadOnly = false;
    state.activeItem = null;
    state.detailLoading = false;
    state.loading = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("countFor", () => {
    it("counts all items", () => {
      expect(feed.countFor("all")).toBe(4);
    });

    it("counts items by type", () => {
      expect(feed.countFor("article")).toBe(1);
      expect(feed.countFor("video")).toBe(1);
      expect(feed.countFor("podcast")).toBe(1);
    });

    it("counts saved items", () => {
      expect(feed.countFor("saved")).toBe(1);
    });
  });

  describe("unreadCount", () => {
    it("returns the number of unread items", () => {
      expect(feed.unreadCount).toBe(2);
    });

    it("updates when an item changes", () => {
      state.items[0].unread = false;
      expect(feed.unreadCount).toBe(1);
    });
  });

  describe("visibleItems", () => {
    it("returns all items when filter is all", () => {
      state.filter = "all";
      expect(feed.visibleItems).toHaveLength(4);
    });

    it("filters by type", () => {
      state.filter = "article";
      const visible = feed.visibleItems;
      expect(visible).toHaveLength(1);
      expect(visible[0].type).toBe("article");
    });

    it("filters saved items", () => {
      state.filter = "saved";
      expect(feed.visibleItems).toHaveLength(1);
      expect(feed.visibleItems.every((i) => i.saved)).toBe(true);
    });

    it("applies unreadOnly across filter", () => {
      state.unreadOnly = true;
      state.filter = "all";
      expect(feed.visibleItems).toHaveLength(2);
      expect(feed.visibleItems.every((i) => i.unread)).toBe(true);
    });
  });

  describe("toggleSave", () => {
    it("saves an unsaved item", () => {
      const i = state.items[0];
      i.saved = false;
      feed.toggleSave(i);
      expect(i.saved).toBe(true);
    });

    it("unsaves a saved item", () => {
      const i = state.items[0];
      i.saved = true;
      feed.toggleSave(i);
      expect(i.saved).toBe(false);
    });
  });

  describe("markAllRead", () => {
    it("sets unread=false on all items", () => {
      feed.markAllRead();
      expect(state.items.every((i) => !i.unread)).toBe(true);
    });
  });

  describe("openItem", () => {
    it("sets activeItem and marks it read", () => {
      const i = state.items[0];
      i.unread = true;
      feed.openItem(i);
      expect(state.activeItem).toBe(i);
      expect(i.unread).toBe(false);
    });

    it("sets detailLoading=true then false after 520ms", () => {
      feed.openItem(state.items[0]);
      expect(state.detailLoading).toBe(true);
      vi.advanceTimersByTime(520);
      expect(state.detailLoading).toBe(false);
    });
  });

  describe("closeDetail", () => {
    it("clears activeItem", () => {
      state.activeItem = state.items[0];
      feed.closeDetail();
      expect(state.activeItem).toBeNull();
    });
  });

  describe("detailNav", () => {
    it("moves to the next item", () => {
      state.activeItem = state.items[0];
      feed.detailNav(1);
      expect(state.activeItem!.id).toBe(2);
    });

    it("moves to the previous item", () => {
      state.activeItem = state.items[1];
      feed.detailNav(-1);
      expect(state.activeItem!.id).toBe(1);
    });

    it("wraps around at the end", () => {
      state.activeItem = state.items[3];
      feed.detailNav(1);
      expect(state.activeItem!.id).toBe(1);
    });

    it("does nothing when no activeItem", () => {
      state.activeItem = null;
      feed.detailNav(1);
      expect(state.activeItem).toBeNull();
    });
  });

  describe("addFeed", () => {
    beforeEach(() => {
      state.feeds = [];
      state.newFeedUrl = "";
    });

    it("adds an RSS feed from a URL", () => {
      state.newFeedUrl = "https://example.com/feed.xml";
      feed.addFeed();
      expect(state.feeds).toHaveLength(1);
      expect(state.feeds[0].type).toBe("rss");
      expect(state.newFeedUrl).toBe("");
    });

    it("detects a podcast URL", () => {
      state.newFeedUrl = "https://podcast.example.com/feed";
      feed.addFeed();
      expect(state.feeds[0].type).toBe("podcast");
    });

    it("does nothing when URL is empty", () => {
      state.newFeedUrl = "   ";
      feed.addFeed();
      expect(state.feeds).toHaveLength(0);
    });
  });

  describe("removeFeed", () => {
    it("removes the feed with the given id", () => {
      state.feeds = [makeFeed({ id: "f1" }), makeFeed({ id: "f2" })] as never;
      feed.removeFeed("f1");
      expect(state.feeds).toHaveLength(1);
      expect(state.feeds[0].id).toBe("f2");
    });
  });

  describe("toggleConn", () => {
    it("connects a disconnected connection", () => {
      const conn = makeConnection({ connected: false, since: "" });
      feed.toggleConn(conn);
      expect(conn.connected).toBe(true);
      expect(conn.since).toBeTruthy();
    });

    it("disconnects a connected connection", () => {
      const conn = makeConnection({
        connected: true,
        since: "Connected just now",
      });
      feed.toggleConn(conn);
      expect(conn.connected).toBe(false);
      expect(conn.since).toBe("");
    });
  });

  describe("contentParagraphs", () => {
    it("splits real synced content into paragraphs", () => {
      expect(
        feed.contentParagraphs({
          content: "First paragraph.\n\nSecond paragraph.",
        }),
      ).toEqual(["First paragraph.", "Second paragraph."]);
    });

    it("collapses single (soft-wrap) newlines within a paragraph to spaces", () => {
      expect(
        feed.contentParagraphs({ content: "  Line one \n wrapped  " }),
      ).toEqual(["Line one wrapped"]);
    });

    it("handles CRLF paragraph breaks from real feeds", () => {
      expect(
        feed.contentParagraphs({ content: "First.\r\n\r\nSecond." }),
      ).toEqual(["First.", "Second."]);
    });

    it("returns an empty array when content is missing", () => {
      expect(feed.contentParagraphs({})).toEqual([]);
    });

    it("returns an empty array when content is a non-string value", () => {
      expect(feed.contentParagraphs({ content: 42 })).toEqual([]);
      expect(feed.contentParagraphs({ content: ["a"] })).toEqual([]);
    });

    it("returns an empty array when content is blank", () => {
      expect(feed.contentParagraphs({ content: "   \n  " })).toEqual([]);
    });

    it("does not fabricate filler from excerpt/title when content is absent", () => {
      const result = feed.contentParagraphs({
        excerpt: "An excerpt",
        title: "A title",
        body: ["Old fake body"],
        notes: ["Old fake note"],
        desc: "Old fake desc",
      });
      expect(result).toEqual([]);
    });
  });

  it("no longer exposes the fabricating content helpers", () => {
    const store = feed as unknown as Record<string, unknown>;
    expect(store.articleBody).toBeUndefined();
    expect(store.podcastNotes).toBeUndefined();
    expect(store.videoDesc).toBeUndefined();
    expect(store.tweetReplies).toBeUndefined();
  });

  describe("loadItems", () => {
    const pageOne = [item({ id: 101 }), item({ id: 102 })];
    const pageTwo = [item({ id: 103 }), item({ id: 104 })];

    beforeEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
    });

    it("replaces items when offset is 0 (first page)", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageOne,
        total: 2,
        nextOffset: null,
      });
      state.items = [item({ id: 999 })];
      await feed.loadItems({ offset: 0 });
      expect(state.items).toHaveLength(2);
      expect(state.items.map((i) => i.id)).toEqual([101, 102]);
    });

    it("replaces items when offset is omitted (first page)", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageOne,
        total: 2,
        nextOffset: null,
      });
      state.items = [item({ id: 999 })];
      await feed.loadItems();
      expect(state.items.map((i) => i.id)).toEqual([101, 102]);
    });

    it("appends items when offset is greater than 0 (subsequent page)", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageTwo,
        total: 4,
        nextOffset: null,
      });
      state.items = pageOne as never;
      await feed.loadItems({ offset: 2 });
      expect(state.items).toHaveLength(4);
      expect(state.items.map((i) => i.id)).toEqual([101, 102, 103, 104]);
    });

    it("does not duplicate first-page items on a repeated first-page load", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageOne,
        total: 2,
        nextOffset: null,
      });
      state.items = pageOne as never;
      await feed.loadItems({ offset: 0 });
      expect(state.items).toHaveLength(2);
    });

    it("deduplicates items with overlapping ids when appending a subsequent page", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: [item({ id: 102 }), item({ id: 103 })],
        total: 3,
        nextOffset: null,
      });
      state.items = pageOne as never;
      await feed.loadItems({ offset: 1 });
      expect(state.items.map((i) => i.id)).toEqual([101, 102, 103]);
    });
  });

  describe("sync queue integration", () => {
    let queueAction: ReturnType<typeof vi.fn>;
    let showToast: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      queueAction = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal(
        "useSyncQueue",
        vi.fn(() => ({ queueAction })),
      );
      showToast = vi.fn();
      vi.stubGlobal(
        "useToast",
        vi.fn(() => ({ showToast })),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    describe("toggleSave", () => {
      it("enqueues a save action with savedAt when saving", async () => {
        const feedItem = state.items[0];
        feedItem.saved = false;
        feedItem.feedId = 10;
        feedItem.guid = "guid-save";

        await feed.toggleSave(feedItem);

        expect(queueAction).toHaveBeenCalledOnce();
        const [action, payload] = queueAction.mock.calls[0];
        expect(action).toBe("save");
        expect(payload.feedId).toBe(10);
        expect(payload.guid).toBe("guid-save");
        expect(typeof payload.savedAt).toBe("string");
      });

      it("enqueues a save action with savedAt=null when unsaving", async () => {
        const feedItem = state.items[0];
        feedItem.saved = true;
        feedItem.feedId = 10;
        feedItem.guid = "guid-unsave";

        await feed.toggleSave(feedItem);

        expect(queueAction).toHaveBeenCalledOnce();
        const [action, payload] = queueAction.mock.calls[0];
        expect(action).toBe("save");
        expect(payload.feedId).toBe(10);
        expect(payload.guid).toBe("guid-unsave");
        expect(payload.savedAt).toBeNull();
      });

      it("rolls back the local state and shows a toast when queueAction rejects", async () => {
        queueAction.mockRejectedValue(new Error("DB unavailable"));
        const feedItem = state.items[0];
        feedItem.saved = false;
        feedItem.feedId = 10;
        feedItem.guid = "guid-save-fail";

        await expect(feed.toggleSave(feedItem)).resolves.toBeUndefined();
        expect(feedItem.saved).toBe(false);
        expect(showToast).toHaveBeenCalledWith(
          "Could not queue change for sync",
        );
      });
    });

    describe("toggleStar", () => {
      it("enqueues a star action with starred=true when starring", async () => {
        const feedItem = state.items[0];
        feedItem.starred = false;
        feedItem.feedId = 20;
        feedItem.guid = "guid-star";

        await feed.toggleStar(feedItem);

        expect(queueAction).toHaveBeenCalledOnce();
        const [action, payload] = queueAction.mock.calls[0];
        expect(action).toBe("star");
        expect(payload.feedId).toBe(20);
        expect(payload.guid).toBe("guid-star");
        expect(payload.starred).toBe(true);
      });

      it("enqueues a star action with starred=false when unstarring", async () => {
        const feedItem = state.items[0];
        feedItem.starred = true;
        feedItem.feedId = 20;
        feedItem.guid = "guid-unstar";

        await feed.toggleStar(feedItem);

        const [action, payload] = queueAction.mock.calls[0];
        expect(action).toBe("star");
        expect(payload.starred).toBe(false);
      });

      it("rolls back the local state and shows a toast when queueAction rejects", async () => {
        queueAction.mockRejectedValue(new Error("DB unavailable"));
        const feedItem = state.items[0];
        feedItem.starred = false;
        feedItem.feedId = 20;
        feedItem.guid = "guid-star-fail";

        await expect(feed.toggleStar(feedItem)).resolves.toBeUndefined();
        expect(feedItem.starred).toBe(false);
        expect(showToast).toHaveBeenCalledWith(
          "Could not queue change for sync",
        );
      });
    });

    describe("markAllRead", () => {
      it("enqueues a markRead action only for items that were unread", async () => {
        state.items = [
          item({ feedId: 1, guid: "g1", unread: true }),
          item({ feedId: 2, guid: "g2", unread: false }),
          item({ feedId: 3, guid: "g3", unread: true }),
        ];

        await feed.markAllRead();

        expect(queueAction).toHaveBeenCalledTimes(2);

        const calls = queueAction.mock.calls;
        expect(calls[0][0]).toBe("markRead");
        expect(calls[0][1].feedId).toBe(1);
        expect(calls[0][1].guid).toBe("g1");
        expect(typeof calls[0][1].readAt).toBe("string");

        expect(calls[1][1].feedId).toBe(3);
        expect(calls[1][1].guid).toBe("g3");
      });

      it("does not enqueue any markRead actions when all items are already read", async () => {
        state.items = [
          item({ feedId: 1, guid: "g1", unread: false }),
          item({ feedId: 2, guid: "g2", unread: false }),
        ];

        await feed.markAllRead();

        expect(queueAction).not.toHaveBeenCalled();
      });

      it("rolls back items to unread and shows a toast when queueAction rejects", async () => {
        queueAction.mockRejectedValue(new Error("DB unavailable"));
        state.items = [
          item({ feedId: 1, guid: "g1", unread: true }),
          item({ feedId: 2, guid: "g2", unread: true }),
        ];

        await expect(feed.markAllRead()).resolves.toBeUndefined();
        expect(showToast).toHaveBeenCalledWith(
          "Could not queue change for sync",
        );
        // Items are rolled back to unread since queueing failed
        expect(state.items.every((i) => i.unread)).toBe(true);
      });
    });

    describe("openItem", () => {
      it("enqueues a markRead action when item was unread", async () => {
        const feedItem = state.items[0];
        feedItem.unread = true;
        feedItem.feedId = 42;
        feedItem.guid = "guid-open";

        await feed.openItem(feedItem);

        expect(queueAction).toHaveBeenCalledOnce();
        const [action, payload] = queueAction.mock.calls[0];
        expect(action).toBe("markRead");
        expect(payload.feedId).toBe(42);
        expect(payload.guid).toBe("guid-open");
        expect(typeof payload.readAt).toBe("string");
      });

      it("does not enqueue a markRead action when item was already read", async () => {
        const feedItem = state.items[0];
        feedItem.unread = false;
        feedItem.feedId = 42;
        feedItem.guid = "guid-already-read";

        await feed.openItem(feedItem);

        expect(queueAction).not.toHaveBeenCalled();
      });

      it("rolls back unread state and shows a toast when queueAction rejects", async () => {
        queueAction.mockRejectedValue(new Error("DB unavailable"));
        const feedItem = state.items[0];
        feedItem.unread = true;
        feedItem.feedId = 42;
        feedItem.guid = "guid-open-fail";

        await expect(feed.openItem(feedItem)).resolves.toBeUndefined();
        expect(feedItem.unread).toBe(true);
        expect(state.activeItem).toBe(feedItem);
        expect(showToast).toHaveBeenCalledWith(
          "Could not queue change for sync",
        );
      });
    });
  });

  describe("refresh", () => {
    let showToast: ReturnType<typeof vi.fn>;

    const stubFetch = (
      syncResponse: unknown,
      reloadItems: Record<string, unknown>[] = [],
    ) => {
      vi.mocked(globalThis.$fetch).mockImplementation((url: string) => {
        if (url === "/api/feed-sync") {
          return Promise.resolve(syncResponse);
        }
        return Promise.resolve({
          items: reloadItems,
          total: reloadItems.length,
          nextOffset: null,
        });
      });
    };

    beforeEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
      showToast = vi.fn();
      vi.stubGlobal(
        "useToast",
        vi.fn(() => ({ showToast })),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("POSTs to /api/feed-sync and reloads items afterward", async () => {
      stubFetch({ queued: 2, eventIds: ["e1", "e2"] }, [
        item({ id: 201 }),
        item({ id: 202 }),
      ]);

      await feed.refresh();

      const calls = vi.mocked(globalThis.$fetch).mock.calls;
      expect(calls[0][0]).toBe("/api/feed-sync");
      expect(calls[0][1]).toMatchObject({ method: "POST" });
      expect(calls[1][0]).toBe("/api/feed-items");
      expect(state.items.map((i) => i.id)).toEqual([201, 202]);
    });

    it("sends the auth token on the sync request when signed in", async () => {
      vi.stubGlobal(
        "useAuth",
        vi.fn(() => ({
          getToken: { value: vi.fn().mockResolvedValue("test-token") },
        })),
      );
      setActivePinia(createPinia());
      const signedInFeed = useFeedStore();
      stubFetch({ queued: 1, eventIds: ["a"] });

      await signedInFeed.refresh();

      const syncCall = vi
        .mocked(globalThis.$fetch)
        .mock.calls.find((call) => call[0] === "/api/feed-sync");
      expect(syncCall![1]).toMatchObject({
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      });
    });

    it("shows a pluralized count toast reflecting queued feeds", async () => {
      stubFetch({ queued: 3, eventIds: ["a", "b", "c"] });

      await feed.refresh();

      expect(showToast).toHaveBeenCalledWith("Checking 3 feeds…");
    });

    it("shows a singular count toast when one feed is queued", async () => {
      stubFetch({ queued: 1, eventIds: ["a"] });

      await feed.refresh();

      expect(showToast).toHaveBeenCalledWith("Checking 1 feed…");
    });

    it("shows an empty-state toast when no feeds are queued", async () => {
      stubFetch({ queued: 0, eventIds: [] });

      await feed.refresh();

      expect(showToast).toHaveBeenCalledWith("No feeds to check yet");
    });

    it("shows an error toast and does not reload items when the sync request fails", async () => {
      vi.mocked(globalThis.$fetch).mockImplementation((url: string) => {
        if (url === "/api/feed-sync") {
          return Promise.reject(new Error("network"));
        }
        return Promise.resolve({ items: [], total: 0, nextOffset: null });
      });

      await expect(feed.refresh()).resolves.toBeUndefined();
      expect(showToast).toHaveBeenCalledWith(
        "Could not refresh feeds — please try again",
      );
      const itemsCall = vi
        .mocked(globalThis.$fetch)
        .mock.calls.find((call) => call[0] === "/api/feed-items");
      expect(itemsCall).toBeUndefined();
      expect(state.loading).toBe(false);

      stubFetch({ queued: 1, eventIds: ["a"] });
      await feed.refresh();
      const syncCalls = vi
        .mocked(globalThis.$fetch)
        .mock.calls.filter((call) => call[0] === "/api/feed-sync");
      expect(syncCalls).toHaveLength(2);
    });

    it("treats a malformed sync response as no feeds queued", async () => {
      stubFetch({});

      await feed.refresh();

      expect(showToast).toHaveBeenCalledWith("No feeds to check yet");
    });

    it("ignores a second refresh while one is already in flight", async () => {
      stubFetch({ queued: 1, eventIds: ["a"] });

      const first = feed.refresh();
      const second = feed.refresh();
      expect(state.loading).toBe(true);

      await Promise.all([first, second]);

      const syncCalls = vi
        .mocked(globalThis.$fetch)
        .mock.calls.filter((call) => call[0] === "/api/feed-sync");
      expect(syncCalls).toHaveLength(1);
      expect(state.loading).toBe(false);
    });

    // A never-settling sync request must time out rather than wedge loading
    // forever; advancing by the store's own constant proves the coupling.
    it("times out a never-settling sync request, surfacing an error and clearing loading", async () => {
      vi.mocked(globalThis.$fetch).mockImplementation((url: string) => {
        if (url === "/api/feed-sync") {
          return new Promise(() => {});
        }
        return Promise.resolve({ items: [], total: 0, nextOffset: null });
      });

      const refreshing = feed.refresh();
      expect(state.loading).toBe(true);

      await vi.advanceTimersByTimeAsync(FEED_SYNC_TIMEOUT_MS);
      await refreshing;

      expect(showToast).toHaveBeenCalledWith(
        "Could not refresh feeds — please try again",
      );
      const itemsCall = vi
        .mocked(globalThis.$fetch)
        .mock.calls.find((call) => call[0] === "/api/feed-items");
      expect(itemsCall).toBeUndefined();
      expect(state.loading).toBe(false);
    });
  });
});
