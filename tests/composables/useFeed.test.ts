import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import {
  useFeedStore,
  FEED_SYNC_TIMEOUT_MS,
  FEED_ITEMS_TIMEOUT_MS,
  MARK_ALL_READ_TIMEOUT_MS,
} from "~/stores/feed";
import { VALID_MARK_ALL_READ_FILTERS } from "../../server/utils/markAllRead";
import { makeFeed, makeConnection } from "../fixtures";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: Math.floor(Math.random() * 1e9),
  feedId: 10,
  guid: "test-guid-1",
  type: "article",
  source: "Test",
  handle: "test.com",
  title: "Test Item",
  content: "Item body content.",
  time: "1h",
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

    it("counts starred items", () => {
      state.items[0].starred = true;
      state.items[2].starred = true;
      expect(feed.countFor("starred")).toBe(2);
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

    it("filters starred items", () => {
      state.items[1].starred = true;
      state.items[3].starred = true;
      state.filter = "starred";
      expect(feed.visibleItems).toHaveLength(2);
      expect(feed.visibleItems.every((i) => i.starred)).toBe(true);
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

    it("returns an empty array for markup content so raw tags are never rendered as text", () => {
      expect(
        feed.contentParagraphs({ content: "<iframe src=x></iframe>" }),
      ).toEqual([]);
      expect(
        feed.contentParagraphs({ content: "<p>Handled by contentHtml</p>" }),
      ).toEqual([]);
    });

    it("treats prose with a stray angle bracket as plain text, not markup", () => {
      expect(
        feed.contentParagraphs({ content: "3 < 5 and 5 > 3 is true" }),
      ).toEqual(["3 < 5 and 5 > 3 is true"]);
    });

    it("treats angle-bracketed non-HTML identifiers as plain text", () => {
      expect(
        feed.contentParagraphs({ content: "Run deploy <env> to ship it" }),
      ).toEqual(["Run deploy <env> to ship it"]);
    });

    it("treats prose inequalities using real tag letters as plain text", () => {
      expect(
        feed.contentParagraphs({ content: "if a<b and b>c then stop" }),
      ).toEqual(["if a<b and b>c then stop"]);
      expect(
        feed.contentParagraphs({ content: "check x<i and y>0 first" }),
      ).toEqual(["check x<i and y>0 first"]);
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

  // Routing only: contentHtml decides plain-text-vs-markup and delegates the
  // actual sanitization to sanitizeFeedHtml. The security guarantees (dangerous
  // markup stripped) and the sanitized structure (paragraph wrapping) are
  // asserted in tests/stores/feedContent.test.ts and
  // tests/utils/sanitizeHtml.test.ts, which run under jsdom where DOMPurify
  // behaves as it does in the browser.
  describe("contentHtml (routing)", () => {
    it("returns an empty string for plain-text content", () => {
      expect(feed.contentHtml({ content: "Just plain text." })).toBe("");
      expect(feed.contentHtml({ content: "First.\n\nSecond." })).toBe("");
    });

    it("returns an empty string for prose with a stray angle bracket", () => {
      expect(feed.contentHtml({ content: "3 < 5 and 5 > 3 is true" })).toBe("");
    });

    it("returns an empty string for angle-bracketed non-HTML identifiers", () => {
      expect(feed.contentHtml({ content: "Run deploy <env> to ship it" })).toBe(
        "",
      );
    });

    it("returns an empty string when content is missing or non-string", () => {
      expect(feed.contentHtml({})).toBe("");
      expect(feed.contentHtml({ content: null })).toBe("");
      expect(feed.contentHtml({ content: 42 })).toBe("");
    });
  });

  describe("postParagraphs", () => {
    it("splits plain-text post content into paragraphs", () => {
      expect(feed.postParagraphs({ content: "One.\n\nTwo." })).toEqual([
        "One.",
        "Two.",
      ]);
    });

    it("shows literal angle-bracket text verbatim instead of an empty state", () => {
      expect(feed.postParagraphs({ content: "<b>hi</b> there" })).toEqual([
        "<b>hi</b> there",
      ]);
    });

    it("returns an empty array when content is absent", () => {
      expect(feed.postParagraphs({})).toEqual([]);
      expect(feed.postParagraphs({ content: null })).toEqual([]);
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

    afterEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
      vi.unstubAllGlobals();
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

    // A never-settling items request must time out rather than hang the load;
    // advancing by the store's own constant proves loadItems is bounded by it.
    it("times out a never-settling items request and surfaces an error toast", async () => {
      const showToast = vi.fn();
      vi.stubGlobal(
        "useToast",
        vi.fn(() => ({ showToast })),
      );
      vi.mocked(globalThis.$fetch).mockImplementation(
        () => new Promise(() => {}),
      );
      state.items = [item({ id: 999 })];

      const loading = feed.loadItems();
      await vi.advanceTimersByTimeAsync(FEED_ITEMS_TIMEOUT_MS - 1);
      expect(showToast).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await loading;

      expect(showToast).toHaveBeenCalledWith(
        "Failed to load feed items — please try again",
      );
      // A timed-out first-page load must not blank the existing feed.
      expect(state.items.map((i) => i.id)).toEqual([999]);
    });
  });

  describe("filter-scoped loading", () => {
    beforeEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: [],
        total: 0,
        nextOffset: null,
      });
    });

    afterEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
    });

    it("omits the filter param when the active filter is all", async () => {
      state.filter = "all";
      await feed.loadItems();
      const options = vi.mocked(globalThis.$fetch).mock.calls[0][1];
      expect(options.query).toEqual({});
    });

    it("sends the active filter as a query param for saved", async () => {
      state.filter = "saved";
      await feed.loadItems();
      const options = vi.mocked(globalThis.$fetch).mock.calls[0][1];
      expect(options.query).toEqual({ filter: "saved" });
    });

    it("sends the active filter alongside the offset when paginating", async () => {
      state.filter = "starred";
      await feed.loadItems({ offset: 20 });
      const options = vi.mocked(globalThis.$fetch).mock.calls[0][1];
      expect(options.query).toEqual({ filter: "starred", offset: "20" });
    });
  });

  describe("loadCounts", () => {
    beforeEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
    });

    afterEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
    });

    it("populates state.counts from the counts endpoint", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        all: 12,
        saved: 4,
        starred: 3,
        article: 6,
        podcast: 1,
        video: 1,
        tweet: 4,
      });
      await feed.loadCounts();
      expect(state.counts.all).toBe(12);
      expect(state.counts.saved).toBe(4);
    });

    it("requests the counts endpoint", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        all: 0,
        saved: 0,
        starred: 0,
      });
      await feed.loadCounts();
      expect(vi.mocked(globalThis.$fetch).mock.calls[0][0]).toBe(
        "/api/feed-item-counts",
      );
    });

    it("leaves existing counts untouched when the request fails", async () => {
      state.counts = { saved: 5 };
      vi.mocked(globalThis.$fetch).mockRejectedValue(new Error("boom"));
      await feed.loadCounts();
      expect(state.counts.saved).toBe(5);
    });
  });

  describe("countFor with server counts", () => {
    it("prefers the whole-account server count over the loaded-page tally", () => {
      state.counts = { saved: 42 };
      expect(feed.countFor("saved")).toBe(42);
    });

    it("falls back to the loaded-page tally when no server count exists", () => {
      state.counts = {};
      // The fixture holds one saved item (id 2).
      expect(feed.countFor("saved")).toBe(1);
    });
  });

  describe("optimistic count adjustment", () => {
    it("increments the saved count when saving with counts loaded", () => {
      state.counts = { saved: 2 };
      const target = state.items[0];
      target.saved = false;
      feed.toggleSave(target);
      expect(state.counts.saved).toBe(3);
    });

    it("decrements the starred count when unstarring", () => {
      state.counts = { starred: 5 };
      const target = state.items[0];
      target.starred = true;
      feed.toggleStar(target);
      expect(state.counts.starred).toBe(4);
    });

    it("never invents a count before the counts have loaded", () => {
      state.counts = {};
      const target = state.items[0];
      target.saved = false;
      feed.toggleSave(target);
      expect(state.counts.saved).toBeUndefined();
    });
  });

  describe("loadMore pagination", () => {
    const pageOne = [item({ id: 201 }), item({ id: 202 })];
    const pageTwo = [item({ id: 203 }), item({ id: 204 })];

    beforeEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
    });

    afterEach(() => {
      vi.mocked(globalThis.$fetch).mockReset();
      vi.unstubAllGlobals();
    });

    it("records nextOffset and reflects it in hasMore after the first page", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageOne,
        total: 2,
        nextOffset: 2,
      });
      await feed.loadItems();
      expect(state.nextOffset).toBe(2);
      expect(feed.hasMore).toBe(true);
    });

    it("fetches the next page at the stored offset and appends it", async () => {
      vi.mocked(globalThis.$fetch)
        .mockResolvedValueOnce({ items: pageOne, total: 4, nextOffset: 2 })
        .mockResolvedValueOnce({ items: pageTwo, total: 4, nextOffset: null });

      await feed.loadItems();
      await feed.loadMore();

      expect(state.items.map((item) => item.id)).toEqual([201, 202, 203, 204]);
      const secondCallOptions = vi.mocked(globalThis.$fetch).mock.calls[1][1];
      expect(secondCallOptions.query).toEqual({ offset: "2" });
      expect(state.nextOffset).toBeNull();
      expect(feed.hasMore).toBe(false);
    });

    it("treats a missing nextOffset as the end of the feed", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageOne,
        total: 2,
      });
      await feed.loadItems();
      expect(state.nextOffset).toBeNull();
      expect(feed.hasMore).toBe(false);
    });

    it("returns false and appends nothing when the page fetch fails", async () => {
      vi.stubGlobal(
        "useToast",
        vi.fn(() => ({ showToast: vi.fn() })),
      );
      vi.mocked(globalThis.$fetch)
        .mockResolvedValueOnce({ items: pageOne, total: 4, nextOffset: 2 })
        .mockRejectedValueOnce(new Error("network"));

      await feed.loadItems();
      const appended = await feed.loadMore();

      expect(appended).toBe(false);
      expect(state.items.map((item) => item.id)).toEqual([201, 202]);
      // Cursor is untouched, so a later scroll can retry the same page.
      expect(state.nextOffset).toBe(2);
    });

    it("does not fetch a next page while a fresh first-page load is in flight", async () => {
      // Seed a cursor, then start a real first-page load that stays pending
      // (never resolves) at the auth/fetch await, so the guard — not a hand-set
      // flag — is what blocks loadMore across the whole first-page window.
      state.nextOffset = 2;
      vi.mocked(globalThis.$fetch).mockReturnValueOnce(new Promise(() => {}));

      feed.loadItems();
      // The flag is set synchronously, before the auth round-trip's await, so it
      // already covers loadMore here.
      expect(state.loadingFirstPage).toBe(true);

      const appended = await feed.loadMore();
      expect(appended).toBe(false);
    });

    it("resets loadingFirstPage after the auth call rejects", async () => {
      vi.stubGlobal(
        "useToast",
        vi.fn(() => ({ showToast: vi.fn() })),
      );
      vi.stubGlobal(
        "useAuth",
        vi.fn(() => ({
          getToken: { value: vi.fn().mockRejectedValue(new Error("no token")) },
        })),
      );
      setActivePinia(createPinia());
      const store = useFeedStore();

      const ok = await store.loadItems();

      // The failure is swallowed to a toast, and the guard flag is released so
      // pagination isn't permanently wedged.
      expect(ok).toBe(false);
      expect(store.state.loadingFirstPage).toBe(false);
    });

    it("drops a stale append when a fresh first page lands mid-flight", async () => {
      let resolveAppend: (_value: unknown) => void = () => {};
      vi.mocked(globalThis.$fetch).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAppend = resolve;
        }),
      );
      state.items = pageOne as never;
      state.nextOffset = 2;

      const appending = feed.loadMore();
      // A fresh first page replaces the list (bumps listVersion) before the
      // append resolves.
      state.items = [item({ id: 301 })] as never;
      state.listVersion += 1;

      resolveAppend({ items: pageTwo, total: 4, nextOffset: null });
      const appended = await appending;

      expect(appended).toBe(false);
      // The stale page-two rows were discarded, not grafted onto the new list.
      expect(state.items.map((item) => item.id)).toEqual([301]);
    });

    it("treats a non-advancing server cursor as the end of the feed", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValueOnce({
        items: pageOne,
        total: 4,
        nextOffset: 2,
      });
      await feed.loadItems();

      // Page two echoes back the same offset it was handed (2), which would loop
      // us on a page we already hold — it must be read as end-of-feed instead.
      vi.mocked(globalThis.$fetch).mockResolvedValueOnce({
        items: pageTwo,
        total: 4,
        nextOffset: 2,
      });
      await feed.loadMore();

      expect(state.nextOffset).toBeNull();
      expect(feed.hasMore).toBe(false);
    });

    it("treats a decreasing server cursor as the end of the feed", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValueOnce({
        items: pageOne,
        total: 4,
        nextOffset: 2,
      });
      await feed.loadItems();

      // The server hands back an offset lower than the one requested — must not
      // be trusted (would re-serve earlier rows) and reads as end-of-feed.
      vi.mocked(globalThis.$fetch).mockResolvedValueOnce({
        items: pageTwo,
        total: 4,
        nextOffset: 1,
      });
      await feed.loadMore();

      expect(state.nextOffset).toBeNull();
      expect(feed.hasMore).toBe(false);
    });

    it("throws (and toasts) on a malformed first-page payload rather than blanking the feed", async () => {
      vi.stubGlobal(
        "useToast",
        vi.fn(() => ({ showToast: vi.fn() })),
      );
      state.items = pageOne as never;
      vi.mocked(globalThis.$fetch).mockResolvedValueOnce({ total: 0 });

      const ok = await feed.loadItems();

      expect(ok).toBe(false);
      // The existing feed is untouched, not replaced with undefined.
      expect(state.items.map((item) => item.id)).toEqual([201, 202]);
    });

    it("is a no-op once the last page has loaded (nextOffset null)", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValue({
        items: pageOne,
        total: 2,
        nextOffset: null,
      });
      await feed.loadItems();
      vi.mocked(globalThis.$fetch).mockClear();

      await feed.loadMore();

      expect(globalThis.$fetch).not.toHaveBeenCalled();
      expect(state.items.map((item) => item.id)).toEqual([201, 202]);
    });

    it("does not fire overlapping requests while a page is in flight", async () => {
      vi.mocked(globalThis.$fetch).mockResolvedValueOnce({
        items: pageOne,
        total: 4,
        nextOffset: 2,
      });
      await feed.loadItems();

      let resolveSecond: (_value: unknown) => void = () => {};
      vi.mocked(globalThis.$fetch).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );

      const first = feed.loadMore();
      const second = feed.loadMore();
      resolveSecond({ items: pageTwo, total: 4, nextOffset: null });
      await Promise.all([first, second]);

      // Two loadMore calls, but only one network request past the initial page.
      expect(globalThis.$fetch).toHaveBeenCalledTimes(2);
      expect(state.items.map((item) => item.id)).toEqual([201, 202, 203, 204]);
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

      it("shows a confirmation toast reflecting the new starred state", async () => {
        const feedItem = state.items[0];
        feedItem.starred = false;

        await feed.toggleStar(feedItem);
        expect(showToast).toHaveBeenCalledWith("Starred");

        await feed.toggleStar(feedItem);
        expect(showToast).toHaveBeenCalledWith("Removed from starred");
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
      beforeEach(() => {
        vi.mocked(globalThis.$fetch).mockReset();
        vi.mocked(globalThis.$fetch).mockResolvedValue({ ok: true });
      });

      it("fires ONE account-scoped bulk request, never one per loaded item", async () => {
        state.items = [
          item({ feedId: 1, guid: "g1", unread: true }),
          item({ feedId: 2, guid: "g2", unread: false }),
          item({ feedId: 3, guid: "g3", unread: true }),
        ];

        await feed.markAllRead();

        // A single bulk call is the whole point of the fix — the account can
        // hold unread items beyond the loaded page, so per-item iteration
        // (queueAction) can never reach them. This must fail if the store
        // reverts to iterating loaded items.
        expect(queueAction).not.toHaveBeenCalled();
        const markAllCalls = vi
          .mocked(globalThis.$fetch)
          .mock.calls.filter((call) => call[0] === "/api/mark-all-read");
        expect(markAllCalls).toHaveLength(1);
        expect(markAllCalls[0][1]).toMatchObject({ method: "POST" });
      });

      it("sends the active filter so the server can scope the update", async () => {
        state.filter = "podcast";
        state.items = [item({ feedId: 1, guid: "g1", unread: true })];

        await feed.markAllRead();

        const markAllCall = vi
          .mocked(globalThis.$fetch)
          .mock.calls.find((call) => call[0] === "/api/mark-all-read");
        expect(markAllCall?.[1]).toMatchObject({
          body: { filter: "podcast" },
        });
      });

      it("optimistically clears unread on loaded items", async () => {
        state.filter = "all";
        state.items = [
          item({ feedId: 1, guid: "g1", unread: true }),
          item({ feedId: 2, guid: "g2", unread: true }),
        ];

        await feed.markAllRead();

        expect(state.items.every((i) => !i.unread)).toBe(true);
      });

      it("leaves items outside the active type filter untouched", async () => {
        state.filter = "podcast";
        const article = item({ type: "article", unread: true });
        const podcast = item({ type: "podcast", unread: true });
        state.items = [article, podcast];

        await feed.markAllRead();

        // Only the filtered-in podcast is optimistically cleared.
        expect(podcast.unread).toBe(false);
        expect(article.unread).toBe(true);
      });

      it("under the saved filter, leaves unsaved unread items untouched", async () => {
        state.filter = "saved";
        const savedItem = item({ unread: true, saved: true });
        const unsavedItem = item({ unread: true, saved: false });
        state.items = [savedItem, unsavedItem];

        await feed.markAllRead();

        expect(savedItem.unread).toBe(false);
        expect(unsavedItem.unread).toBe(true);
      });

      it("every dashboard filter id is accepted by the server endpoint", () => {
        // Guards against drift: adding a filter chip whose id the server does
        // not recognize would make "Mark all read" 400 under that filter.
        const unknown = feed.filterDefs.filter(
          (def) => !VALID_MARK_ALL_READ_FILTERS.has(def.id),
        );
        expect(unknown).toEqual([]);
      });

      it("ignores a second call while the first is still in flight", async () => {
        state.items = [item({ feedId: 1, guid: "g1", unread: true })];

        // The guard flips synchronously at the top of markAllRead, so a second
        // call issued before the first resolves is a no-op — only one request.
        const first = feed.markAllRead();
        const second = feed.markAllRead();
        await Promise.all([first, second]);

        const markAllCalls = vi
          .mocked(globalThis.$fetch)
          .mock.calls.filter((call) => call[0] === "/api/mark-all-read");
        expect(markAllCalls).toHaveLength(1);
      });

      it("resyncs from the server (not a blind rollback) when the request times out", async () => {
        // On timeout the bulk update may have committed after we stopped
        // waiting, so a blind rollback would desync the UI. Instead re-read the
        // list from the server. The mark-all-read call never settles (forcing
        // the timeout); the follow-up feed-items read resolves.
        vi.mocked(globalThis.$fetch).mockImplementation((url: string) => {
          if (url === "/api/mark-all-read") {
            return new Promise(() => {});
          }
          return Promise.resolve({ items: [], total: 0, nextOffset: null });
        });
        state.items = [item({ feedId: 1, guid: "g1", unread: true })];

        const pending = feed.markAllRead();
        await vi.advanceTimersByTimeAsync(MARK_ALL_READ_TIMEOUT_MS);
        await pending;

        const reloadCalls = vi
          .mocked(globalThis.$fetch)
          .mock.calls.filter((call) => call[0] === "/api/feed-items");
        expect(reloadCalls).toHaveLength(1);
        expect(showToast).toHaveBeenCalledWith(
          "Still marking as read — refreshing to confirm",
        );
      });

      it("gives feedback (no silent drop) when a second call is suppressed", async () => {
        state.items = [item({ feedId: 1, guid: "g1", unread: true })];

        const first = feed.markAllRead();
        const second = feed.markAllRead();
        await Promise.all([first, second]);

        expect(showToast).toHaveBeenCalledWith("Still marking as read…");
      });

      it("rolls back optimistic changes and shows a toast when the request fails", async () => {
        vi.mocked(globalThis.$fetch).mockRejectedValue(
          new Error("network down"),
        );
        state.items = [
          item({ feedId: 1, guid: "g1", unread: true }),
          item({ feedId: 2, guid: "g2", unread: true }),
        ];

        await expect(feed.markAllRead()).resolves.toBeUndefined();
        expect(showToast).toHaveBeenCalledWith(
          "Could not mark all as read — please try again",
        );
        // Loaded items revert to unread since the bulk request failed.
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

    // The post-sync items load is the wedge FEED_ITEMS_TIMEOUT_MS guards: sync
    // resolves but /api/feed-items never settles, so without the bound refresh()
    // would leave loading stuck forever.
    it("clears loading when the post-sync items load never settles", async () => {
      vi.mocked(globalThis.$fetch).mockImplementation((url: string) => {
        if (url === "/api/feed-sync") {
          return Promise.resolve({ queued: 1, eventIds: ["a"] });
        }
        return new Promise(() => {});
      });

      const refreshing = feed.refresh();
      await vi.advanceTimersByTimeAsync(FEED_ITEMS_TIMEOUT_MS - 1);
      expect(showToast).not.toHaveBeenCalledWith(
        "Failed to load feed items — please try again",
      );
      await vi.advanceTimersByTimeAsync(1);
      await refreshing;

      expect(showToast).toHaveBeenCalledWith(
        "Failed to load feed items — please try again",
      );
      expect(state.loading).toBe(false);
    });
  });
});
