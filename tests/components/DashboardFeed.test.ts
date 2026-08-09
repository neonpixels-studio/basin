import { describe, it, expect, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import DashboardFeed from "~/components/DashboardFeed.vue";
import { useFeedStore } from "~/stores/feed";

function setItems(items) {
  const state = useFeedStore().state;
  state.items = items;
}

describe("DashboardFeed", () => {
  beforeEach(() => {
    const state = useFeedStore().state;
    state.items = [];
    state.loading = false;
    state.filter = "all";
    state.unreadOnly = false;
    state.layout = "timeline";
  });

  it("renders skeleton cards while loading", () => {
    useFeedStore().state.loading = true;
    const wrapper = shallowMount(DashboardFeed);
    expect(wrapper.findAll("skeleton-card-stub")).toHaveLength(
      useFeedStore().skeletonKinds.length,
    );
  });

  it("shows the empty state when there are no items", () => {
    const wrapper = shallowMount(DashboardFeed);
    expect(wrapper.find(".empty").exists()).toBe(true);
    expect(wrapper.find("dashboard-feed-grid-stub").exists()).toBe(false);
  });

  it("renders the grid layout for timeline/grid when items exist", () => {
    setItems([{ id: 1, type: "article" }]);
    useFeedStore().state.layout = "timeline";
    const wrapper = shallowMount(DashboardFeed);
    expect(wrapper.find("dashboard-feed-grid-stub").exists()).toBe(true);
    expect(wrapper.find("dashboard-feed-columns-stub").exists()).toBe(false);
  });

  it("renders the columns layout when the layout is columns", () => {
    setItems([{ id: 1, type: "article" }]);
    useFeedStore().state.layout = "columns";
    const wrapper = shallowMount(DashboardFeed);
    expect(wrapper.find("dashboard-feed-columns-stub").exists()).toBe(true);
    expect(wrapper.find("dashboard-feed-grid-stub").exists()).toBe(false);
  });
});
