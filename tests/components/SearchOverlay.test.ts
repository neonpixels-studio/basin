import { describe, it, expect, beforeEach, vi } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import SearchOverlay from "~/components/SearchOverlay.vue";
import { useSearch } from "~/composables/useSearch";

const { state } = useSearch();

// A query no page title/sub matches, so without the error the template would
// otherwise fall through to the "No matches" empty state.
const NO_PAGE_MATCH_QUERY = "zzznomatchzzz";
// Slightly longer than the 300ms search debounce in the component.
const DEBOUNCE_WAIT_MS = 350;

// Drives the component through a failed /api/search request and returns the
// mounted wrapper sitting in its error state.
async function mountWithFailedSearch() {
  vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(new Error("network down")));
  state.open = true;
  const wrapper = shallowMount(SearchOverlay);
  state.query = NO_PAGE_MATCH_QUERY;
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_WAIT_MS));
  await flushPromises();
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("SearchOverlay", () => {
  beforeEach(() => {
    state.open = false;
    state.query = "";
    state.cursor = 0;
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

  it("matches snapshot (open, search request failed)", async () => {
    const wrapper = await mountWithFailedSearch();
    expect(wrapper.html()).toMatchSnapshot();
  });
});
