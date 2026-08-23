import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  shallowMount,
  flushPromises,
  enableAutoUnmount,
} from "@vue/test-utils";
import SearchOverlay from "~/components/SearchOverlay.vue";
import { useSearch } from "~/composables/useSearch";

const { state } = useSearch();

// A query no page title/sub matches, so without the error the template would
// otherwise fall through to the "No matches" empty state.
const NO_PAGE_MATCH_QUERY = "zzznomatchzzz";
// Must match the search debounce delay in SearchOverlay.vue.
const SEARCH_DEBOUNCE_MS = 300;

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

// Mounts the overlay, types a non-matching query, and drives the debounced
// request to completion with the given $fetch behaviour. Uses fake timers so
// the 300ms debounce resolves instantly instead of sleeping in real time.
async function runSearch(fetchImplementation) {
  vi.useFakeTimers();
  vi.stubGlobal("$fetch", fetchImplementation);
  state.open = true;
  const wrapper = shallowMount(SearchOverlay);
  state.query = NO_PAGE_MATCH_QUERY;
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  await flushPromises();
  await wrapper.vm.$nextTick();
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
    expect(wrapper.text()).toContain("Search unavailable");
    expect(wrapper.text()).not.toContain("No matches");
  });

  it("shows 'No matches', not the error state, on a successful empty result", async () => {
    const wrapper = await runSearch(vi.fn().mockResolvedValue([]));
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  it("clears the error state after a successful retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([]);
    const wrapper = await runSearch(fetchMock);
    expect(wrapper.find(".search-error").exists()).toBe(true);

    state.query = `${NO_PAGE_MATCH_QUERY}x`;
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".search-error").exists()).toBe(false);
    expect(wrapper.text()).toContain("No matches");
  });

  it("does not surface an error when a failed request was superseded by a newer one", async () => {
    const firstRequest = deferred();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce([]);
    vi.useFakeTimers();
    vi.stubGlobal("$fetch", fetchMock);
    state.open = true;
    const wrapper = shallowMount(SearchOverlay);

    state.query = `${NO_PAGE_MATCH_QUERY}a`;
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    state.query = `${NO_PAGE_MATCH_QUERY}b`;
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    firstRequest.reject(new Error("aborted"));
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".search-error").exists()).toBe(false);
  });

  it("matches snapshot (open, search request failed)", async () => {
    const wrapper = await mountWithFailedSearch();
    expect(wrapper.html()).toMatchSnapshot();
  });
});
