import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import DashboardFeedGrid from "~/components/DashboardFeedGrid.vue";
import { useFeedStore } from "~/stores/feed";

const PAGE_SIZE = 20;

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

  it("does not advance the window when a page fetch fails", async () => {
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

    // Fetch failed: no items appended, window not advanced past the loaded page.
    expect(useFeedStore().state.items).toHaveLength(PAGE_SIZE);
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE);
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
