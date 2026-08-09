import { describe, it, expect, beforeEach, vi } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
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
// the sentinel scrolling into view without a real IntersectionObserver.
function captureOnIntersect() {
  let onIntersect = () => {};
  globalThis.useInfiniteScroll = vi.fn((_sentinel, callback) => {
    onIntersect = callback;
  });
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

    globalThis.$fetch = vi.fn().mockResolvedValue({
      items: makeItems(PAGE_SIZE, PAGE_SIZE + 1),
      total: PAGE_SIZE * 2,
      nextOffset: null,
    });

    const wrapper = shallowMount(DashboardFeedGrid, {
      props: { stagger: false },
    });
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE);

    await triggerIntersect();
    await flushPromises();

    // Page two was fetched at the stored offset and appended — no longer capped
    // at the first page — and the newly loaded items are revealed.
    expect(globalThis.$fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.$fetch.mock.calls[0][1].query).toEqual({
      offset: String(PAGE_SIZE),
    });
    expect(useFeedStore().state.items).toHaveLength(PAGE_SIZE * 2);
    expect(wrapper.findAll("feed-item-stub")).toHaveLength(PAGE_SIZE * 2);
    expect(wrapper.find(".feed-end").exists()).toBe(true);
  });
});
