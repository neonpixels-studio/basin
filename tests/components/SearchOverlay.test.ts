import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  shallowMount,
  flushPromises,
  enableAutoUnmount,
} from "@vue/test-utils";
import SearchOverlay from "~/components/SearchOverlay.vue";
import { useSearch } from "~/composables/useSearch";
import { mapSearchRow } from "../../server/utils/search";

const { state } = useSearch();

// A query no page title/sub matches, so the template falls through to the
// "No matches" empty state when the search succeeds with no results.
const NO_PAGE_MATCH_QUERY = "zzznomatchzzz";

// The /api/search response is a page object ({ items, nextOffset }), not a bare
// array — these builders keep the test mocks in sync with that contract.
const emptyPage = () => ({ items: [], nextOffset: null });

const resultItem = (id) => ({
  id,
  feedId: 10,
  guid: `guid-${id}`,
  type: "article",
  source: "Test Feed",
  time: "2h",
  title: `Result ${id}`,
  url: `https://example.com/${id}`,
  author: null,
  imageUrl: null,
  content: null,
  tags: null,
});

const pageOf = (ids, nextOffset) => ({
  items: ids.map(resultItem),
  nextOffset,
});

// A promise whose settlement the test controls — used to hold a request
// in-flight while a newer query supersedes it.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Mounts the overlay with a controlled $fetch. Fake timers let the debounce
// resolve instantly instead of sleeping in real time.
function mountOverlay(fetchImplementation) {
  vi.useFakeTimers();
  vi.stubGlobal("$fetch", fetchImplementation);
  state.open = true;
  return shallowMount(SearchOverlay);
}

// Types a query and drains the debounce timer plus the resulting request.
async function typeQuery(wrapper, query) {
  state.query = query;
  await vi.runAllTimersAsync();
  await flushPromises();
  await wrapper.vm.$nextTick();
}

async function runSearch(fetchImplementation, query = NO_PAGE_MATCH_QUERY) {
  const wrapper = mountOverlay(fetchImplementation);
  await typeQuery(wrapper, query);
  return wrapper;
}

const mountWithFailedSearch = () =>
  runSearch(vi.fn().mockRejectedValue(new Error("network down")));

enableAutoUnmount(afterEach);

describe("SearchOverlay", () => {
  beforeEach(() => {
    state.open = false;
    state.query = "";
    state.cursor = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders nothing when closed", () => {
    state.open = false;
    const wrapper = shallowMount(SearchOverlay);
    expect(wrapper.find(".search-scrim").exists()).toBe(false);
  });

  it("renders the search modal when open", async () => {
    state.open = true;
    const wrapper = shallowMount(SearchOverlay);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".search-scrim").exists()).toBe(true);
    expect(wrapper.find(".search-modal").exists()).toBe(true);
  });

  it("matches snapshot (closed)", () => {
    state.open = false;
    const wrapper = shallowMount(SearchOverlay);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (open, empty query)", async () => {
    state.open = true;
    state.query = "";
    const wrapper = shallowMount(SearchOverlay);
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("shows a distinct error state, not 'No matches', when the search request fails", async () => {
    const wrapper = await mountWithFailedSearch();
    expect(wrapper.find(".search-error").exists()).toBe(true);
    expect(wrapper.text()).toContain("Search is unavailable");
    expect(wrapper.text()).not.toContain("No matches");
  });

  it("surfaces the error even when a page still matches the query", async () => {
    const wrapper = await runSearch(
      vi.fn().mockRejectedValue(new Error("network down")),
      "feed",
    );
    expect(wrapper.find(".search-error").exists()).toBe(true);
    // The Pages group still renders (Settings/Dashboard match "feed")…
    expect(wrapper.text()).toContain("Dashboard");
    // …but the error must not be masked as a "No matches" result.
    expect(wrapper.text()).not.toContain("No matches");
  });

  it("shows the error state when the API returns a body without an items array", async () => {
    const wrapper = await runSearch(
      vi.fn().mockResolvedValue({ error: "boom" }),
    );
    expect(wrapper.find(".search-error").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("No matches");
  });

  it("shows the error state when the API returns a bare array (old contract)", async () => {
    const wrapper = await runSearch(vi.fn().mockResolvedValue([]));
    expect(wrapper.find(".search-error").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("No matches");
  });

  it("shows 'No matches', not the error state, on a successful empty result", async () => {
    const wrapper = await runSearch(vi.fn().mockResolvedValue(emptyPage()));
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  // Regression: #247. This is the seam that actually broke — chooseRow()
  // hands the raw /api/search row to feedStore.openItem() — so it stubs the
  // wire response with a real mapSearchRow() output (what the API route
  // actually serializes) and asserts the sync fires from a click, not just
  // that the store function behaves correctly in isolation.
  describe("opening a search result", () => {
    const mockSearchResultRow = (overrides = {}) => ({
      id: 9001,
      feedId: 7,
      feedSource: "rss",
      feedTitle: "Test Feed",
      guid: "guid-overlay-result",
      title: "Found via search",
      url: null,
      author: null,
      imageUrl: null,
      content: null,
      tags: null,
      publishedAt: null,
      readAt: null,
      starred: false,
      savedAt: null,
      createdAt: null,
      updatedAt: null,
      ...overrides,
    });

    it("marks an unread search result read and fires the sync when opened", async () => {
      const queueAction = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal(
        "useSyncQueue",
        vi.fn(() => ({ queueAction })),
      );
      const searchResult = mapSearchRow(mockSearchResultRow({ readAt: null }));

      const wrapper = await runSearch(
        vi.fn().mockResolvedValue({ items: [searchResult], nextOffset: null }),
        "found",
      );
      await wrapper.find(".sr-item").trigger("click");
      await flushPromises();

      expect(queueAction).toHaveBeenCalledOnce();
      const [action, payload] = queueAction.mock.calls[0];
      expect(action).toBe("markRead");
      expect(payload.feedId).toBe(7);
      expect(payload.guid).toBe("guid-overlay-result");
    });

    it("does not fire the sync when an already-read search result is opened", async () => {
      const queueAction = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal(
        "useSyncQueue",
        vi.fn(() => ({ queueAction })),
      );
      const searchResult = mapSearchRow(
        mockSearchResultRow({ readAt: new Date("2026-01-01T00:00:00Z") }),
      );

      const wrapper = await runSearch(
        vi.fn().mockResolvedValue({ items: [searchResult], nextOffset: null }),
        "found",
      );
      await wrapper.find(".sr-item").trigger("click");
      await flushPromises();

      expect(queueAction).not.toHaveBeenCalled();
    });
  });

  it("clears a stale error the moment the query changes, before the retry fires", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(emptyPage());
    const wrapper = await runSearch(fetchMock);
    expect(wrapper.find(".search-error").exists()).toBe(true);

    // Changing the query clears the previous failure synchronously — before the
    // debounced retry has even fired (guards the watcher's searchError reset).
    state.query = `${NO_PAGE_MATCH_QUERY}x`;
    await wrapper.vm.$nextTick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".search-error").exists()).toBe(false);

    // The successful retry keeps it clear.
    await vi.runAllTimersAsync();
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  it("re-runs the failed query and clears the error when Retry is clicked", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(emptyPage());
    const wrapper = await runSearch(fetchMock);
    expect(wrapper.find(".search-error").exists()).toBe(true);

    await wrapper.find(".search-error .btn").trigger("click");
    await vi.runAllTimersAsync();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(
      encodeURIComponent(NO_PAGE_MATCH_QUERY),
    );
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  it("keeps the error banner when a retry fails again", async () => {
    const wrapper = await runSearch(
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    expect(wrapper.find(".search-error").exists()).toBe(true);

    await wrapper.find(".search-error .btn").trigger("click");
    await vi.runAllTimersAsync();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".search-error").exists()).toBe(true);
  });

  it("does not surface an error when a failed request was superseded by a newer one", async () => {
    const firstRequest = deferred();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(emptyPage());
    const wrapper = mountOverlay(fetchMock);

    await typeQuery(wrapper, `${NO_PAGE_MATCH_QUERY}a`);
    await typeQuery(wrapper, `${NO_PAGE_MATCH_QUERY}b`);
    firstRequest.reject(new Error("aborted"));
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  it("shows a Load more button when the result page reports a next offset", async () => {
    const wrapper = await runSearch(
      vi.fn().mockResolvedValue(pageOf([1, 2], 20)),
    );
    expect(wrapper.find(".search-load-more").exists()).toBe(true);
    expect(wrapper.findAll(".sr-item")).toHaveLength(2);
  });

  it("does not show a Load more button on the last page (nextOffset null)", async () => {
    const wrapper = await runSearch(
      vi.fn().mockResolvedValue(pageOf([1, 2], null)),
    );
    expect(wrapper.find(".search-load-more").exists()).toBe(false);
    expect(wrapper.findAll(".sr-item")).toHaveLength(2);
  });

  it("appends the next page and hides the button once the last page loads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockResolvedValueOnce(pageOf([3], null));
    const wrapper = await runSearch(fetchMock);
    expect(wrapper.findAll(".sr-item")).toHaveLength(2);

    await wrapper.find(".search-load-more").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=20");
    expect(wrapper.findAll(".sr-item")).toHaveLength(3);
    expect(wrapper.find(".search-load-more").exists()).toBe(false);
  });

  it("relabels the persistent button to a busy state while a load-more is in flight", async () => {
    const secondRequest = deferred();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockReturnValueOnce(secondRequest.promise);
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await wrapper.vm.$nextTick();

    // The button stays mounted (so focus can't fall to <body>) and switches to
    // a busy label + aria-busy rather than being replaced by a separate node.
    const button = wrapper.find(".search-load-more");
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("Loading more…");
    expect(button.attributes("aria-busy")).toBe("true");

    secondRequest.resolve(pageOf([3], null));
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll(".sr-item")).toHaveLength(3);
  });

  it("ignores a click on the busy button so a load-more can't fire twice", async () => {
    const secondRequest = deferred();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockReturnValueOnce(secondRequest.promise);
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await wrapper.vm.$nextTick();
    // A second click while busy must not start another request.
    await wrapper.find(".search-load-more").trigger("click");
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    secondRequest.resolve(pageOf([3], null));
    await flushPromises();
  });

  it("shows an inline error on a load-more failure without wiping loaded results, and recovers when the button is pressed again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(pageOf([3], null));
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Loaded results survive, the whole-panel error state is not shown, and the
    // load-more button is still there to retry through.
    expect(wrapper.find(".search-load-more-error").exists()).toBe(true);
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.findAll(".sr-item")).toHaveLength(2);
    expect(wrapper.find(".search-load-more").exists()).toBe(true);

    await wrapper.find(".search-load-more").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(wrapper.find(".search-load-more-error").exists()).toBe(false);
    expect(wrapper.findAll(".sr-item")).toHaveLength(3);
    expect(wrapper.find(".search-load-more").exists()).toBe(false);
  });

  it("keeps the overlay open when Enter is pressed on Load more, though a bare window Enter would close it", async () => {
    // attachTo the document so events dispatched on the button actually bubble
    // to the window keydown listener — without it, this test would pass whether
    // or not @keydown.enter.stop is present.
    vi.useFakeTimers();
    vi.stubGlobal("$fetch", vi.fn().mockResolvedValue(pageOf([1, 2], 20)));
    const wrapper = shallowMount(SearchOverlay, { attachTo: document.body });
    state.open = true;
    await typeQuery(wrapper, NO_PAGE_MATCH_QUERY);

    // Control: a bare window Enter does close the overlay, proving the listener
    // is live under attachTo.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await wrapper.vm.$nextTick();
    expect(state.open).toBe(false);

    // Reopen, then press Enter on the button: @keydown.enter.stop must stop it
    // reaching the window handler, so the overlay stays open. A fresh query
    // string re-triggers the fetch (the watcher ignores an unchanged value).
    state.open = true;
    await typeQuery(wrapper, `${NO_PAGE_MATCH_QUERY}2`);
    await wrapper.find(".search-load-more").trigger("keydown.enter");
    await wrapper.vm.$nextTick();
    expect(state.open).toBe(true);

    wrapper.unmount();
  });

  it("drops duplicate ids across pages so a row never renders twice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      // Page 2 repeats id 2 (e.g. a rank tie or an offset shift) plus a new id.
      .mockResolvedValueOnce(pageOf([2, 3], null));
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Only ids 1, 2, 3 render — the duplicate 2 is dropped, not rendered twice.
    expect(wrapper.findAll(".sr-item")).toHaveLength(3);
  });

  it("drops a load-more append when the query changes mid-flight", async () => {
    const secondRequest = deferred();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockReturnValueOnce(secondRequest.promise)
      .mockResolvedValueOnce(emptyPage());
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await wrapper.vm.$nextTick();

    // A new query supersedes the in-flight load-more before it resolves.
    await typeQuery(wrapper, `${NO_PAGE_MATCH_QUERY}x`);
    secondRequest.resolve(pageOf([3], null));
    await flushPromises();
    await wrapper.vm.$nextTick();

    // The stale page 2 (id 3) must never land on the new query's results.
    expect(wrapper.text()).not.toContain("Result 3");
  });

  it("returns focus to the search input when the last page removes the Load more button", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockResolvedValueOnce(pageOf([3], null));
    vi.stubGlobal("$fetch", fetchMock);
    const wrapper = shallowMount(SearchOverlay, { attachTo: document.body });
    state.open = true;
    await typeQuery(wrapper, NO_PAGE_MATCH_QUERY);

    const button = wrapper.find(".search-load-more");
    button.element.focus();
    expect(document.activeElement).toBe(button.element);

    await button.trigger("click");
    await flushPromises();
    await vi.runAllTimersAsync();
    await wrapper.vm.$nextTick();

    // Last page loaded → button unmounts → focus must land back on the input,
    // not fall to <body> where a stray Enter would open a result.
    expect(wrapper.find(".search-load-more").exists()).toBe(false);
    expect(document.activeElement?.id).toBe("reader-search-input");

    wrapper.unmount();
  });

  it("drops an in-flight load-more append when the overlay closes before it resolves", async () => {
    const secondRequest = deferred();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1, 2], 20))
      .mockReturnValueOnce(secondRequest.promise);
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await wrapper.vm.$nextTick();

    // Close the overlay while the load-more is still in flight, then resolve it.
    state.open = false;
    await wrapper.vm.$nextTick();
    secondRequest.resolve(pageOf([3], null));
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Reopen WITHOUT changing the query (so no fresh fetch masks the check): the
    // stale page must not have grafted id 3 onto the list the close cleared.
    // Removing the loadMoreAbortController guard makes this fail.
    state.open = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".sr-item")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("Result 3");
  });

  it("treats a non-advancing next offset as end-of-results on load more", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageOf([1], 20))
      // Server echoes back the same offset — must be treated as the last page,
      // not looped on forever.
      .mockResolvedValueOnce(pageOf([2], 20));
    const wrapper = await runSearch(fetchMock);

    await wrapper.find(".search-load-more").trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".search-load-more").exists()).toBe(false);
    expect(wrapper.findAll(".sr-item")).toHaveLength(2);
  });

  it("matches snapshot (open, search request failed)", async () => {
    const wrapper = await mountWithFailedSearch();
    expect(wrapper.html()).toMatchSnapshot();
  });
});
