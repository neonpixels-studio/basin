import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  shallowMount,
  flushPromises,
  enableAutoUnmount,
} from "@vue/test-utils";
import SearchOverlay from "~/components/SearchOverlay.vue";
import { useSearch } from "~/composables/useSearch";

const { state } = useSearch();

// A query no page title/sub matches, so the template falls through to the
// "No matches" empty state when the search succeeds with no results.
const NO_PAGE_MATCH_QUERY = "zzznomatchzzz";

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

  it("shows the error state when the API returns a non-array body", async () => {
    const wrapper = await runSearch(
      vi.fn().mockResolvedValue({ error: "boom" }),
    );
    expect(wrapper.find(".search-error").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("No matches");
  });

  it("shows 'No matches', not the error state, on a successful empty result", async () => {
    const wrapper = await runSearch(vi.fn().mockResolvedValue([]));
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  it("clears a stale error the moment the query changes, before the retry fires", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([]);
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
      .mockResolvedValueOnce([]);
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
      .mockResolvedValueOnce([]);
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

  it("matches snapshot (open, search request failed)", async () => {
    const wrapper = await mountWithFailedSearch();
    expect(wrapper.html()).toMatchSnapshot();
  });
});
