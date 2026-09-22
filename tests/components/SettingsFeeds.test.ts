import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { ref } from "vue";
import SettingsFeeds from "~/components/SettingsFeeds.vue";

const rssItem = {
  id: 1,
  url: "https://example.com/feed.xml",
  title: "Test Feed",
  source: "rss",
  createdAt: null,
};
const podItem = {
  id: 2,
  url: "https://podcast.example.com/feed",
  title: null,
  source: "podcast",
  createdAt: null,
};
const failingItem = {
  id: 3,
  url: "https://failing.example.com/feed.xml",
  title: "Failing Feed",
  source: "rss",
  createdAt: null,
  syncStatus: "error",
  syncError: "Feed unreachable — check the URL",
};

function stubFeeds(overrides: Partial<ReturnType<typeof makeStub>> = {}) {
  const stub = makeStub(overrides);
  vi.stubGlobal("useFeeds", () => stub);
  return stub;
}

function makeStub(
  overrides: {
    items?: (typeof rssItem)[];
    error?: string | null;
    detectedSource?: "rss" | "podcast" | null;
    pendingFeedUrl?: string | null;
    importing?: boolean;
    exporting?: boolean;
    importSummary?: {
      importedCount: number;
      skipped: { url: string; title: string | null; reason: string }[];
    } | null;
    isRetrying?: (_id: number) => boolean;
  } = {},
) {
  return {
    items: ref(overrides.items ?? [rssItem, podItem]),
    newUrl: ref(""),
    loading: ref(false),
    isAdding: ref(false),
    discovering: ref(false),
    detecting: ref(false),
    error: ref(overrides.error ?? null),
    detectedSource: ref(overrides.detectedSource ?? null),
    sourceOverride: ref(null),
    pendingFeedUrl: ref(overrides.pendingFeedUrl ?? null),
    importing: ref(overrides.importing ?? false),
    exporting: ref(overrides.exporting ?? false),
    importSummary: ref(overrides.importSummary ?? null),
    load: vi.fn(),
    add: vi.fn(),
    confirmAdd: vi.fn(),
    remove: vi.fn(),
    importOpml: vi.fn(),
    exportOpml: vi.fn(),
    retryFeed: vi.fn(),
    isRetrying: overrides.isRetrying ?? vi.fn(() => false),
  };
}

describe("SettingsFeeds", () => {
  beforeEach(() => stubFeeds());

  it("renders a row for each feed", () => {
    const wrapper = shallowMount(SettingsFeeds);
    expect(wrapper.findAll(".feed-row")).toHaveLength(2);
  });

  it("shows the feed title when available", () => {
    const wrapper = shallowMount(SettingsFeeds);
    expect(wrapper.find(".feed-name").text()).toBe("Test Feed");
  });

  it("falls back to the URL when title is null", () => {
    const wrapper = shallowMount(SettingsFeeds);
    const names = wrapper.findAll(".feed-name").map((n) => n.text());
    expect(names).toContain("https://podcast.example.com/feed");
  });

  it("calls remove with the feed id when the remove button is clicked", async () => {
    const stub = stubFeeds();
    const wrapper = shallowMount(SettingsFeeds);
    await wrapper.find(".icon-btn").trigger("click");
    expect(stub.remove).toHaveBeenCalledWith(1);
  });

  it("calls add when the Add feed button is clicked", async () => {
    const stub = stubFeeds();
    const wrapper = shallowMount(SettingsFeeds);
    await wrapper.find(".btn.btn-primary").trigger("click");
    expect(stub.add).toHaveBeenCalled();
  });

  it("passes error to InputText when error is set", () => {
    stubFeeds({ error: "Failed to load feeds" });
    const wrapper = shallowMount(SettingsFeeds);
    expect(wrapper.find("input-text-stub").attributes("error")).toBe(
      "Failed to load feeds",
    );
  });

  it("shows empty state when there are no feeds", () => {
    stubFeeds({ items: [] });
    const wrapper = shallowMount(SettingsFeeds);
    expect(wrapper.findAll(".feed-row")).toHaveLength(0);
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot with feeds", () => {
    const wrapper = shallowMount(SettingsFeeds);
    expect(wrapper.html()).toMatchSnapshot();
  });

  describe("needs-attention indicator", () => {
    it("shows a needs-attention badge for a feed with a sync error", () => {
      stubFeeds({ items: [rssItem, failingItem] });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.findAll(".feed-stat.error")).toHaveLength(1);
    });

    it("does not show a needs-attention badge for a healthy feed", () => {
      stubFeeds({ items: [rssItem] });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.find(".feed-stat.error").exists()).toBe(false);
    });

    it("surfaces the sync error message as the badge title", () => {
      stubFeeds({ items: [failingItem] });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.find(".feed-stat.error").attributes("title")).toBe(
        "Feed unreachable — check the URL",
      );
    });

    it("matches snapshot with a failing feed", () => {
      stubFeeds({ items: [rssItem, failingItem] });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.html()).toMatchSnapshot();
    });

    it("shows a Retry now control only for the failing feed's row", () => {
      stubFeeds({ items: [rssItem, failingItem] });
      const wrapper = shallowMount(SettingsFeeds);
      const retryButtons = wrapper
        .findAll(".icon-btn")
        .filter((button) => button.attributes("title")?.includes("Retry"));
      expect(retryButtons).toHaveLength(1);
    });

    it("does not show a Retry now control for a healthy feed", () => {
      stubFeeds({ items: [rssItem] });
      const wrapper = shallowMount(SettingsFeeds);
      const retryButtons = wrapper
        .findAll(".icon-btn")
        .filter((button) => button.attributes("title")?.includes("Retry"));
      expect(retryButtons).toHaveLength(0);
    });

    it("does not show a Retry now control for a paused failing feed", () => {
      // A paused feed always 409s /api/feeds/:id/retry (over the Free plan's
      // source cap), so the control is hidden rather than offered and failing.
      stubFeeds({ items: [{ ...failingItem, paused: true }] });
      const wrapper = shallowMount(SettingsFeeds);
      const retryButtons = wrapper
        .findAll(".icon-btn")
        .filter((button) => button.attributes("title")?.includes("Retry"));
      expect(retryButtons).toHaveLength(0);
    });

    it("calls retryFeed with the feed id when Retry now is clicked", async () => {
      const stub = stubFeeds({ items: [failingItem] });
      const wrapper = shallowMount(SettingsFeeds);
      const retryButton = wrapper
        .findAll(".icon-btn")
        .find((button) => button.attributes("title")?.includes("Retry"));
      await retryButton!.trigger("click");
      expect(stub.retryFeed).toHaveBeenCalledWith(failingItem.id);
    });

    it("disables the Retry now control while a retry is in flight for that feed", () => {
      stubFeeds({
        items: [failingItem],
        isRetrying: (id: number) => id === failingItem.id,
      });
      const wrapper = shallowMount(SettingsFeeds);
      const retryButton = wrapper
        .findAll(".icon-btn")
        .find((button) => button.attributes("title") === "Retrying…");
      expect(retryButton).toBeDefined();
      expect(retryButton!.attributes("disabled")).toBeDefined();
    });

    it("does not disable the Retry now control for a feed that is not retrying", () => {
      stubFeeds({
        items: [failingItem],
        isRetrying: () => false,
      });
      const wrapper = shallowMount(SettingsFeeds);
      const retryButton = wrapper
        .findAll(".icon-btn")
        .find((button) => button.attributes("title") === "Retry now");
      expect(retryButton!.attributes("disabled")).toBeUndefined();
    });
  });

  describe("detection confirmation UI", () => {
    it("shows the detect-confirm panel when detectedSource and pendingFeedUrl are set", () => {
      stubFeeds({
        detectedSource: "rss",
        pendingFeedUrl: "https://example.com/feed.xml",
      });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.find(".detect-confirm").exists()).toBe(true);
    });

    it("hides the detect-confirm panel when pendingFeedUrl is null", () => {
      stubFeeds({ detectedSource: null, pendingFeedUrl: null });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.find(".detect-confirm").exists()).toBe(false);
    });

    it("shows Detected: RSS label for an rss feed", () => {
      stubFeeds({
        detectedSource: "rss",
        pendingFeedUrl: "https://example.com/feed.xml",
      });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.find(".detect-label").text()).toContain("RSS");
    });

    it("shows Detected: Podcast label for a podcast feed", () => {
      stubFeeds({
        detectedSource: "podcast",
        pendingFeedUrl: "https://podcast.example.com/feed.xml",
      });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.find(".detect-label").text()).toContain("Podcast");
    });

    it("calls confirmAdd when the confirm button is clicked", async () => {
      const stub = stubFeeds({
        detectedSource: "rss",
        pendingFeedUrl: "https://example.com/feed.xml",
      });
      const wrapper = shallowMount(SettingsFeeds);
      await wrapper.find(".detect-actions .btn-primary").trigger("click");
      expect(stub.confirmAdd).toHaveBeenCalled();
    });

    it("matches snapshot with detect-confirm visible", () => {
      stubFeeds({
        detectedSource: "podcast",
        pendingFeedUrl: "https://podcast.example.com/feed.xml",
      });
      const wrapper = shallowMount(SettingsFeeds);
      expect(wrapper.html()).toMatchSnapshot();
    });
  });

  describe("OPML import/export wiring", () => {
    // The actual file-picker and summary-rendering behavior lives in
    // FeedOpmlActions.vue (tests/components/FeedOpmlActions.test.ts) —
    // shallowMount stubs it here, so these tests only cover that
    // SettingsFeeds wires its useFeeds() state and actions to it correctly.
    it("passes importing, exporting, and importSummary to FeedOpmlActions", () => {
      stubFeeds({
        importing: true,
        exporting: true,
        importSummary: { importedCount: 2, skipped: [] },
      });
      const wrapper = shallowMount(SettingsFeeds);
      const opmlActions = wrapper.find("feed-opml-actions-stub");
      expect(opmlActions.attributes("importing")).toBe("true");
      expect(opmlActions.attributes("exporting")).toBe("true");
    });

    it("calls importOpml when FeedOpmlActions emits import-file", async () => {
      const stub = stubFeeds();
      const wrapper = shallowMount(SettingsFeeds);
      const file = new File(["<opml></opml>"], "feeds.opml", {
        type: "text/x-opml",
      });
      await wrapper
        .findComponent({ name: "FeedOpmlActions" })
        .vm.$emit("import-file", file);
      expect(stub.importOpml).toHaveBeenCalledWith(file);
    });

    it("calls exportOpml when FeedOpmlActions emits export", async () => {
      const stub = stubFeeds();
      const wrapper = shallowMount(SettingsFeeds);
      await wrapper
        .findComponent({ name: "FeedOpmlActions" })
        .vm.$emit("export");
      expect(stub.exportOpml).toHaveBeenCalled();
    });
  });
});
