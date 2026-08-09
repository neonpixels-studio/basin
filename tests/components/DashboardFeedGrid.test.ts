import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import DashboardFeedGrid, {
  PAGE_SIZE,
  MAX_PAGES_PER_SCROLL,
} from "~/components/DashboardFeedGrid.vue";
import { useFeedStore } from "~/stores/feed";

function makeItems(count, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    type: "article",
  }));
}

// Capture the intersection callback the grid registers so tests can simulate
// the sentinel scrolling into view without a real IntersectionObserver. Uses
// vi.stubGlobal so afterEach can restore the auto-import stub — a bare
// assignment would leak into later tests sharing the environment.
function captureOnIntersect() {
  let onIntersect = () => {};
  vi.stubGlobal(
    "useInfiniteScroll",
    vi.fn((_sentinel, callback) => {
      onIntersect = callback;
    }),
  );
  return () => onIntersect();
}

describe("DashboardFeedGrid", () => {
  beforeEach(() => {
    const state = useFeedStore().state;
    state.items = [];
    state.loading = false;
    state.filter = "all";
    state.unreadOnly = false;
    state.layout = "timeline";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a feed item for each item within the window", () => {
    useFeedStore().state.items = makeItems(3);
    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(3);
  });

  it("shows the end-of-feed message when all items fit in the window", () => {
    useFeedStore().state.items = makeItems(3);
    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    expect(wrapper.find(".feed-end").exists()).toBe(true);
    expect(wrapper.find(".feed-sentinel").exists()).toBe(false);
  });

  it("windows to the page size and keeps the sentinel when more items remain", () => {
    useFeedStore().state.items = makeItems(PAGE_SIZE + 5);
    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE);
    expect(wrapper.find(".feed-sentinel").exists()).toBe(true);
    expect(wrapper.find(".feed-end").exists()).toBe(false);
  });

  it("keeps the sentinel when the window is full but more pages exist on the server", () => {
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE);
    state.nextOffset = PAGE_SIZE;
    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    // The whole first page is windowed, but the server has more, so the feed
    // is not "at the end" and the sentinel must stay to trigger the next fetch.
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE);
    expect(wrapper.find(".feed-sentinel").exists()).toBe(true);
    expect(wrapper.find(".feed-end").exists()).toBe(false);
  });

  it("fetches and appends the next page when the sentinel fires past the first page", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE);
    state.nextOffset = PAGE_SIZE;

    const fetchMock = vi.fn().mockResolvedValue({
      items: makeItems(PAGE_SIZE, PAGE_SIZE + 1),
      total: PAGE_SIZE * 2,
      nextOffset: null,
    });
    vi.stubGlobal("$fetch", fetchMock);

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE);

    await triggerIntersect();
    await flushPromises();

    // Page two was fetched at the stored offset and appended — no longer capped
    // at the first page — and the newly loaded items are revealed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].query).toEqual({
      offset: String(PAGE_SIZE),
    });
    expect(useFeedStore().state.items).toHaveLength(PAGE_SIZE * 2);
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE * 2);
    expect(wrapper.find(".feed-end").exists()).toBe(true);
  });

  it("shows the loading-more indicator only while a page is in flight", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE);
    state.nextOffset = PAGE_SIZE;

    let resolveFetch = () => {};
    vi.stubGlobal(
      "$fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = () =>
              resolve({
                items: makeItems(PAGE_SIZE, PAGE_SIZE + 1),
                total: PAGE_SIZE * 2,
                nextOffset: null,
              });
          }),
      ),
    );

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });

    const pending = triggerIntersect();
    // Flush microtasks up to the still-pending fetch so loadingMore is set and
    // the deferred resolver is wired, without settling the request itself.
    await flushPromises();
    expect(wrapper.find(".feed-loading-more").exists()).toBe(true);

    resolveFetch();
    await pending;
    await flushPromises();
    expect(wrapper.find(".feed-loading-more").exists()).toBe(false);
  });

  it("surfaces an error and offers manual retry when a page fetch fails", async () => {
    const showToast = vi.fn();
    vi.stubGlobal(
      "useToast",
      vi.fn(() => ({ showToast })),
    );
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE);
    state.nextOffset = PAGE_SIZE;

    vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(new Error("boom")));

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });

    await triggerIntersect();
    await flushPromises();

    // Nothing appended, cursor untouched so a retry is still possible, and the
    // failure is not misreported as end-of-feed.
    expect(useFeedStore().state.items).toHaveLength(PAGE_SIZE);
    expect(useFeedStore().state.nextOffset).toBe(PAGE_SIZE);
    expect(wrapper.find(".feed-end").exists()).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      "Failed to load feed items — please try again",
    );
    // The sentinel can't self-recover on a full-screen list, so a manual
    // "Load more" affordance is shown instead.
    expect(wrapper.find(".feed-load-more").exists()).toBe(true);
  });

  it("recovers via the manual button after a failed fetch, reaching the end", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE);
    state.nextOffset = PAGE_SIZE;

    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("boom"));
    vi.stubGlobal("$fetch", fetchMock);

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });

    await triggerIntersect();
    await flushPromises();
    expect(wrapper.find(".feed-load-more").exists()).toBe(true);

    // The retry succeeds and returns the final page.
    fetchMock.mockResolvedValueOnce({
      items: makeItems(PAGE_SIZE, PAGE_SIZE + 1),
      total: PAGE_SIZE * 2,
      nextOffset: null,
    });
    await wrapper.find(".feed-load-more").trigger("click");
    await flushPromises();

    expect(wrapper.find(".feed-load-more").exists()).toBe(false);
    expect(useFeedStore().state.items).toHaveLength(PAGE_SIZE * 2);
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE * 2);
    expect(wrapper.find(".feed-end").exists()).toBe(true);
  });

  it("does not stall a successful load when the sentinel fires twice concurrently", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE);
    state.nextOffset = PAGE_SIZE;

    let resolveFetch = () => {};
    vi.stubGlobal(
      "$fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = () =>
              resolve({
                items: makeItems(PAGE_SIZE, PAGE_SIZE + 1),
                total: PAGE_SIZE * 2,
                nextOffset: null,
              });
          }),
      ),
    );

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });

    const first = triggerIntersect();
    await flushPromises();
    // A second intersect lands while the first fetch is still pending.
    await triggerIntersect();

    resolveFetch();
    await first;
    await flushPromises();

    // The successful load is not misreported as a stall.
    expect(wrapper.find(".feed-load-more").exists()).toBe(false);
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE * 2);
  });

  it("keeps fetching within the bound until a page yields a filter match", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = [{ id: 1, type: "podcast" }]; // one visible podcast
    state.filter = "podcast";
    state.nextOffset = PAGE_SIZE;

    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      // Pages 1 and 2 of the burst are articles (no match); page 3 has a podcast.
      const type = call < 3 ? "article" : "podcast";
      const nextOffset = call * PAGE_SIZE + PAGE_SIZE;
      return Promise.resolve({
        items: [{ id: 100 + call, type }],
        total: 1000,
        nextOffset,
      });
    });
    vi.stubGlobal("$fetch", fetchMock);

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });

    await triggerIntersect();
    await flushPromises();

    // Exactly 3 pages fetched — stops the instant a match lands, not at the bound.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(2); // both podcasts
  });

  it("stops at the per-scroll page bound when a filter matches nothing new", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE); // all type "article"
    state.filter = "podcast"; // nothing in any fetched page will match
    state.nextOffset = PAGE_SIZE;

    let offset = PAGE_SIZE;
    const fetchMock = vi.fn().mockImplementation(() => {
      offset += PAGE_SIZE;
      return Promise.resolve({
        items: makeItems(PAGE_SIZE, offset), // more articles, still no podcasts
        total: 1000,
        nextOffset: offset, // always more pages available
      });
    });
    vi.stubGlobal("$fetch", fetchMock);

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });

    await triggerIntersect();
    await flushPromises();

    // Bounded: exactly MAX pages fetched, more still available, manual retry offered.
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PAGES_PER_SCROLL);
    expect(useFeedStore().state.nextOffset).not.toBeNull();
    expect(wrapper.find(".feed-load-more").exists()).toBe(true);
  });

  it("resets the window to the first page when the filter changes", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE * 3);
    state.nextOffset = null;

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    triggerIntersect();
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE * 2);

    state.filter = "podcast";
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE);
  });

  it("resets the window to the first page when the unread toggle changes", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE * 3);
    state.nextOffset = null;

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    triggerIntersect();
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE * 2);

    state.unreadOnly = true;
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE);
  });

  it("does not reset the window when older items are appended to the list", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE * 3);
    state.nextOffset = null;

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    triggerIntersect();
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE * 2);

    // Simulate an append (offset > 0) growing the list without bumping listVersion.
    state.items = [...state.items, ...makeItems(PAGE_SIZE, PAGE_SIZE * 3 + 1)];
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE * 2);
  });

  it("resets the window when the store replaces the list with a fresh first page", async () => {
    const triggerIntersect = captureOnIntersect();
    const state = useFeedStore().state;
    state.items = makeItems(PAGE_SIZE * 3);
    state.nextOffset = null;

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    triggerIntersect();
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE * 2);

    // A refresh replaces items and bumps listVersion, which must reset the window.
    state.items = makeItems(PAGE_SIZE);
    state.listVersion += 1;
    await nextTick();
    expect(wrapper.vm.visibleCount).toBe(PAGE_SIZE);
  });
});
