import { defineStore } from "pinia";
import { reactive, computed } from "vue";
import {
  feeds as seedFeeds,
  connections as seedConnections,
} from "~/data/mock";
import { SOURCES } from "~/lib/icons";
import { $fetchWithTimeout } from "~/utils/fetchWithTimeout";

const clone = (x: unknown) => JSON.parse(JSON.stringify(x));

// Abort the feed-sync request after this many ms so a never-settling response
// can't wedge the refresh loading state. Exported so tests advance their fake
// timers by the exact same value.
export const FEED_SYNC_TIMEOUT_MS = 15000;

// Bounds every /api/feed-items load — dashboard mount and the post-sync reload in
// refresh() — so a never-settling response can't hang the caller. Independent of
// FEED_SYNC_TIMEOUT_MS: a slow-but-successful sync followed by a hung items load
// can hold refresh()'s loading state for the sum of the two. Exported so tests
// advance their fake timers by the exact same value.
export const FEED_ITEMS_TIMEOUT_MS = 15000;

export const useFeedStore = defineStore("feed", () => {
  const { getToken } = useAuth();

  const state = reactive({
    items: [] as Record<string, unknown>[],
    feeds: clone(seedFeeds),
    connections: clone(seedConnections),
    filter: "all",
    layout: "timeline",
    unreadOnly: false,
    loading: true,
    revealDone: true,
    activeItem: null as Record<string, unknown> | null,
    detailLoading: false,
    newFeedUrl: "",
    // Server pagination cursor for /api/feed-items. Null means the first page
    // hasn't loaded yet or the last page returned no further offset (end of feed).
    nextOffset: null as number | null,
    loadingMore: false,
    // True only while a first page (mount load or refresh) is actually in
    // flight. loadMore checks this — not the cosmetic `loading` reveal timer —
    // so it won't fire mid-refresh yet also won't be blocked by the stagger.
    loadingFirstPage: false,
    // Bumped whenever the item list is replaced (a fresh first page or refresh),
    // never on an append. Consumers watch it to reset scroll windows on a new
    // list without resetting when older pages are appended.
    listVersion: 0,
  });

  const timers: Record<string, ReturnType<typeof setTimeout> | null> = {
    load: null,
    reveal: null,
    detail: null,
  };
  let initialized = false;
  let refreshing = false;

  const filterDefs = [
    { id: "all", label: "All", c: "var(--accent)" },
    { id: "article", label: "RSS", c: "var(--src-rss)" },
    { id: "podcast", label: "Podcasts", c: "var(--src-podcast)" },
    { id: "video", label: "YouTube", c: "var(--src-video)" },
    { id: "tweet", label: "Bluesky", c: "var(--src-tweet)" },
    { id: "saved", label: "Saved", c: "var(--accent)" },
  ];

  const skeletonKinds = ["article", "video", "tweet", "podcast", "article"];

  const unreadCount = computed(
    () => state.items.filter((i: Record<string, unknown>) => i.unread).length,
  );

  const visibleItems = computed(() => {
    let list = state.items;
    if (state.unreadOnly)
      list = list.filter((i: Record<string, unknown>) => i.unread);
    if (state.filter === "saved")
      return list.filter((i: Record<string, unknown>) => i.saved);
    if (state.filter !== "all")
      return list.filter(
        (i: Record<string, unknown>) => i.type === state.filter,
      );
    return list;
  });

  const decks = computed(() => {
    const order = ["article", "podcast", "video", "tweet"];
    return order
      .map((t) => ({
        type: t,
        meta: SOURCES[t as keyof typeof SOURCES],
        items: state.items.filter((i: Record<string, unknown>) => i.type === t),
      }))
      .filter((d) => d.items.length);
  });

  async function loadSettingsFromDb() {
    const { load } = useUserSettings();
    const settings = await load();
    state.layout = settings.layout ?? "timeline";
    state.unreadOnly = settings.showUnreadOnly ?? false;
  }

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const token = await getToken.value();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  const LOAD_ITEMS_ERROR_MESSAGE =
    "Failed to load feed items — please try again";

  interface FeedItemsResponse {
    items: Record<string, unknown>[];
    total: number;
    nextOffset: number | null;
  }

  function buildItemsQuery(params: {
    limit?: number;
    offset?: number;
  }): Record<string, string> {
    const query: Record<string, string> = {};
    if (params.limit !== undefined) {
      query.limit = String(params.limit);
    }
    if (params.offset !== undefined) {
      query.offset = String(params.offset);
    }
    return query;
  }

  function appendPage(response: FeedItemsResponse) {
    const seen = new Set(state.items.map((item) => item.id));
    state.items = [
      ...state.items,
      ...response.items.filter((item) => !seen.has(item.id)),
    ];
  }

  // Apply a fetched page. Returns false only when a first page superseded this
  // append mid-flight (listVersion moved), so the stale rows are dropped.
  function applyItemsResponse(
    response: FeedItemsResponse,
    isFirstPage: boolean,
    requestVersion: number,
  ): boolean {
    if (!isFirstPage && state.listVersion !== requestVersion) {
      return false;
    }
    if (isFirstPage) {
      state.items = response.items;
      state.listVersion += 1;
    } else {
      appendPage(response);
    }
    state.nextOffset =
      typeof response.nextOffset === "number" ? response.nextOffset : null;
    return true;
  }

  // Resolves to true when the page was fetched and applied, false when the
  // request failed or was superseded — so callers (loadMore) can tell success
  // from a swallowed error rather than blindly advancing their scroll window.
  async function loadItems(
    params: { limit?: number; offset?: number } = {},
  ): Promise<boolean> {
    const { showToast } = useToast();
    const isFirstPage = (params.offset ?? 0) === 0;
    // Snapshot the list generation before any await. If a fresh first page
    // lands while this append is in flight, listVersion moves and we drop the
    // stale append rather than grafting old-offset rows onto the new list.
    const requestVersion = state.listVersion;
    // Set before any await so loadMore's guard closes the whole first-page
    // window, including the auth token round-trip, not just the items fetch.
    if (isFirstPage) {
      state.loadingFirstPage = true;
    }
    const headers = await buildAuthHeaders();
    const query = buildItemsQuery(params);

    try {
      const response = await $fetchWithTimeout<FeedItemsResponse>(
        "/api/feed-items",
        FEED_ITEMS_TIMEOUT_MS,
        { headers, query },
      );
      return applyItemsResponse(response, isFirstPage, requestVersion);
    } catch {
      showToast(LOAD_ITEMS_ERROR_MESSAGE);
      return false;
    } finally {
      if (isFirstPage) {
        state.loadingFirstPage = false;
      }
    }
  }

  const hasMore = computed(() => typeof state.nextOffset === "number");

  // Fetch and append the next page of feed items. Guarded so a burst of
  // intersection events can't fire overlapping requests, a first-page (re)load
  // in flight can't be raced by a stale-offset append, and it no-ops once the
  // last page has been reached. Returns whether a page was fetched and applied.
  async function loadMore(): Promise<boolean> {
    if (
      state.loadingMore ||
      state.loadingFirstPage ||
      state.nextOffset === null
    ) {
      return false;
    }
    state.loadingMore = true;
    try {
      return await loadItems({ offset: state.nextOffset });
    } finally {
      state.loadingMore = false;
    }
  }

  async function setupWatchers() {
    if (initialized || !import.meta.client) return;
    initialized = true;

    const { save } = useUserSettings();
    await loadSettingsFromDb();

    watch(
      () => state.layout,
      (layout: string) => {
        save({ layout });
        runFeedLoad(380);
      },
    );
    watch(
      () => state.unreadOnly,
      (showUnreadOnly: boolean) => {
        save({ showUnreadOnly });
      },
    );
    watch(
      () => state.filter,
      () => runFeedLoad(420),
    );
    setTimeout(() => {
      state.loading = false;
    }, 650);
  }

  function revealAfterLoad() {
    state.loading = false;
    if (timers.reveal) {
      clearTimeout(timers.reveal);
    }
    timers.reveal = setTimeout(() => {
      state.revealDone = true;
    }, 950);
  }

  function runFeedLoad(ms = 650) {
    state.loading = true;
    state.revealDone = false;
    if (timers.load) clearTimeout(timers.load);
    timers.load = setTimeout(revealAfterLoad, ms);
  }

  const REFRESH_ERROR_MESSAGE = "Could not refresh feeds — please try again";

  async function triggerFeedSync(): Promise<number> {
    const headers = await buildAuthHeaders();
    const result = await $fetchWithTimeout<{ queued?: number }>(
      "/api/feed-sync",
      FEED_SYNC_TIMEOUT_MS,
      { method: "POST", headers },
    );
    const queued = Number(result?.queued);
    return Number.isFinite(queued) && queued > 0 ? queued : 0;
  }

  function syncToastMessage(queued: number): string {
    if (queued === 0) {
      return "No feeds to check yet";
    }
    return `Checking ${queued} feed${queued === 1 ? "" : "s"}…`;
  }

  async function refresh() {
    if (refreshing) {
      return;
    }
    refreshing = true;
    const { showToast } = useToast();
    if (timers.load) {
      clearTimeout(timers.load);
    }
    if (timers.reveal) {
      clearTimeout(timers.reveal);
    }
    state.loading = true;
    state.revealDone = false;
    try {
      const queued = await triggerFeedSync();
      showToast(syncToastMessage(queued));
      await loadItems();
    } catch {
      showToast(REFRESH_ERROR_MESSAGE);
    } finally {
      refreshing = false;
      revealAfterLoad();
    }
  }

  function countFor(id: string) {
    if (id === "all") return state.items.length;
    if (id === "saved")
      return state.items.filter((i: Record<string, unknown>) => i.saved).length;
    return state.items.filter((i: Record<string, unknown>) => i.type === id)
      .length;
  }

  const SYNC_ERROR_MESSAGE = "Could not queue change for sync";

  async function toggleSave(item: Record<string, unknown>) {
    const { showToast } = useToast();
    const previousSaved = item.saved;
    item.saved = !item.saved;
    showToast(item.saved ? "Saved for later" : "Removed from saved");

    const { queueAction } = useSyncQueue();
    try {
      await queueAction("save", {
        feedId: item.feedId,
        guid: item.guid,
        savedAt: item.saved ? new Date().toISOString() : null,
      });
    } catch {
      item.saved = previousSaved;
      showToast(SYNC_ERROR_MESSAGE);
    }
  }

  async function toggleStar(item: Record<string, unknown>) {
    const { showToast } = useToast();
    const previousStarred = item.starred;
    item.starred = !item.starred;

    const { queueAction } = useSyncQueue();
    try {
      await queueAction("star", {
        feedId: item.feedId,
        guid: item.guid,
        starred: item.starred,
      });
    } catch {
      item.starred = previousStarred;
      showToast(SYNC_ERROR_MESSAGE);
    }
  }

  async function markAllRead() {
    const { showToast } = useToast();
    const unreadItems = state.items.filter(
      (i: Record<string, unknown>) => i.unread === true,
    );
    unreadItems.forEach((i: Record<string, unknown>) => {
      i.unread = false;
    });
    showToast("Marked all as read");

    const { queueAction } = useSyncQueue();
    const now = new Date().toISOString();
    for (const feedItem of unreadItems) {
      try {
        await queueAction("markRead", {
          feedId: feedItem.feedId,
          guid: feedItem.guid,
          readAt: now,
        });
      } catch {
        feedItem.unread = true;
        showToast(SYNC_ERROR_MESSAGE);
      }
    }
  }

  async function openItem(item: Record<string, unknown>) {
    const wasUnread = item.unread === true;
    item.unread = false;
    state.activeItem = item;
    state.detailLoading = true;
    if (timers.detail) {
      clearTimeout(timers.detail);
    }
    timers.detail = setTimeout(() => {
      state.detailLoading = false;
    }, 520);
    if (import.meta.client) {
      document.body.style.overflow = "hidden";
    }

    if (!wasUnread) {
      return;
    }

    const { showToast } = useToast();
    const { queueAction } = useSyncQueue();
    try {
      await queueAction("markRead", {
        feedId: item.feedId,
        guid: item.guid,
        readAt: new Date().toISOString(),
      });
    } catch {
      item.unread = true;
      showToast(SYNC_ERROR_MESSAGE);
    }
  }

  function closeDetail() {
    state.activeItem = null;
    if (import.meta.client) document.body.style.overflow = "";
  }

  function detailNav(dir: number) {
    const list = visibleItems.value;
    if (!state.activeItem || !list.length) return;
    let idx = list.findIndex(
      (i: Record<string, unknown>) => i.id === state.activeItem!.id,
    );
    if (idx === -1) return;
    idx = (idx + dir + list.length) % list.length;
    openItem(list[idx]);
  }

  function addFeed() {
    const { showToast } = useToast();
    const url = state.newFeedUrl.trim();
    if (!url) return;
    const isPod = /podcast|simplecast|megaphone|\.mp3|audio/i.test(url);
    state.feeds.unshift({
      id: "n" + Date.now(),
      type: isPod ? "podcast" : "rss",
      name: url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
      url: url.replace(/^https?:\/\//, ""),
      count: 0,
      color: isPod ? "var(--src-podcast)" : "var(--src-rss)",
      status: "ok",
    });
    state.newFeedUrl = "";
    showToast("Feed added · fetching latest");
  }

  function removeFeed(id: string) {
    const { showToast } = useToast();
    state.feeds = state.feeds.filter(
      (f: Record<string, unknown>) => f.id !== id,
    );
    showToast("Feed removed");
  }

  function toggleConn(c: Record<string, unknown>) {
    const { showToast } = useToast();
    c.connected = !c.connected;
    c.since = c.connected ? "Connected just now" : "";
    showToast(c.connected ? `${c.name} connected` : `${c.name} disconnected`);
  }

  const cardComponentName = (type: string) =>
    ({
      article: "ArticleCard",
      video: "VideoCard",
      podcast: "PodcastCard",
      tweet: "TweetCard",
    })[type];

  const PARAGRAPH_BREAK = /\n\s*\n/;
  const SOFT_WRAP = /\s*\n\s*/g;

  // Split a synced item's real `content` into display paragraphs: blank lines
  // separate paragraphs, single (soft-wrap) newlines collapse to spaces.
  // Returns an empty array when the feed carried no content, so the view can
  // show an honest empty state instead of inventing filler.
  // @todo `content` may carry raw HTML (e.g. podcast `itunes:summary`); it is
  // rendered as escaped text for now. Sanitize + render markup in a follow-up.
  const contentParagraphs = (item: Record<string, unknown>) => {
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) {
      return [];
    }
    return content
      .split(PARAGRAPH_BREAK)
      .map((paragraph) => paragraph.replace(SOFT_WRAP, " ").trim())
      .filter(Boolean);
  };

  const sourceMeta = (type: string) => SOURCES[type as keyof typeof SOURCES];

  return {
    state,
    filterDefs,
    skeletonKinds,
    unreadCount,
    visibleItems,
    decks,
    countFor,
    loadItems,
    loadMore,
    hasMore,
    setupWatchers,
    runFeedLoad,
    refresh,
    toggleSave,
    toggleStar,
    markAllRead,
    openItem,
    closeDetail,
    detailNav,
    addFeed,
    removeFeed,
    toggleConn,
    cardComponentName,
    contentParagraphs,
    sourceMeta,
  };
});
