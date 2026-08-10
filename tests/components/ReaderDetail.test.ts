import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import ReaderDetail from "~/components/ReaderDetail.vue";
import DetailProse from "~/components/DetailProse.vue";
import { useFeedStore } from "~/stores/feed";
import { makeArticle, makeVideo, makePodcast, makeTweet } from "../fixtures";
import { isPlayableUrl } from "~/composables/usePodcastPlayer";

describe("ReaderDetail", () => {
  let state: ReturnType<typeof useFeedStore>["state"];

  // Register DetailProse so shallowMount resolves and stubs it, letting us
  // assert the real props passed in (not a brittle stringified attribute) and
  // keeping snapshots free of unresolved-component warnings.
  const mountDetail = () =>
    shallowMount(ReaderDetail, {
      global: { components: { DetailProse } },
    });

  beforeEach(() => {
    // setup.ts creates a fresh Pinia before each test; get the store here
    // so it shares the same instance that the component will use.
    state = useFeedStore().state;
    state.activeItem = null;
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when there is no active item", () => {
    state.activeItem = null;
    const wrapper = mountDetail();
    expect(wrapper.find(".detail-scrim").exists()).toBe(false);
  });

  it("renders the detail sheet when an item is active", async () => {
    state.activeItem = makeArticle() as never;
    const wrapper = mountDetail();
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".detail-scrim").exists()).toBe(true);
  });

  it("matches snapshot (no active item)", () => {
    state.activeItem = null;
    const wrapper = mountDetail();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (with active article)", async () => {
    state.activeItem = makeArticle() as never;
    const wrapper = mountDetail();
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (with active video)", async () => {
    state.activeItem = makeVideo() as never;
    const wrapper = mountDetail();
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (with active podcast)", async () => {
    state.activeItem = makePodcast() as never;
    const wrapper = mountDetail();
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (with active tweet)", async () => {
    state.activeItem = makeTweet() as never;
    const wrapper = mountDetail();
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toMatchSnapshot();
  });

  describe("header open-original button", () => {
    it("opens the item URL in a new tab when clicked", async () => {
      state.activeItem = makeArticle({
        url: "https://test.example.com/article-1",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const openOriginalButton = wrapper
        .findAll(".icon-btn")
        .find((btn) => btn.attributes("title") === "Open original");
      expect(openOriginalButton).toBeDefined();
      await openOriginalButton!.trigger("click");

      expect(window.open).toHaveBeenCalledWith(
        "https://test.example.com/article-1",
        "_blank",
        "noopener,noreferrer",
      );
    });

    it("does nothing when item has no URL", async () => {
      state.activeItem = makeArticle({ url: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const openOriginalButton = wrapper
        .findAll(".icon-btn")
        .find((btn) => btn.attributes("title") === "Open original");
      await openOriginalButton!.trigger("click");

      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe("article body open-original anchor", () => {
    it("renders an anchor with correct href and target when url is present", async () => {
      state.activeItem = makeArticle({
        url: "https://test.example.com/article-1",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const anchor = wrapper.find('a[rel="noopener noreferrer"]');
      expect(anchor.exists()).toBe(true);
      expect(anchor.attributes("href")).toBe(
        "https://test.example.com/article-1",
      );
      expect(anchor.attributes("target")).toBe("_blank");
    });

    it("hides the anchor when url is null", async () => {
      state.activeItem = makeArticle({ url: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('article a[rel="noopener noreferrer"]').exists(),
      ).toBe(false);
    });
  });

  describe("video watch-on-youtube anchor", () => {
    it("renders an anchor with the video URL", async () => {
      state.activeItem = makeVideo({
        url: "https://www.youtube.com/watch?v=test123",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const anchor = wrapper.find('a[rel="noopener noreferrer"]');
      expect(anchor.exists()).toBe(true);
      expect(anchor.attributes("href")).toBe(
        "https://www.youtube.com/watch?v=test123",
      );
      expect(anchor.attributes("target")).toBe("_blank");
    });
  });

  describe("podcast play button", () => {
    // Stub the shared player so we can assert on control calls without a real
    // <audio> element; canPlay uses the genuine URL-safety check.
    function stubPlayer(
      overrides: { active?: boolean; progress?: number } = {},
    ) {
      const active = overrides.active ?? false;
      const toggle = vi.fn();
      const seekBy = vi.fn();
      const scrubTo = vi.fn();
      const player = {
        state: {
          currentUrl: null,
          playing: active,
          currentTime: 0,
          duration: 0,
        },
        progress: overrides.progress ?? 0,
        seekStep: 15,
        play: vi.fn(),
        pause: vi.fn(),
        toggle,
        seekBy,
        seekToFraction: vi.fn(),
        scrubTo,
        isActive: () => active,
        isPlaying: () => active,
        canPlay: (url: string | null) => isPlayableUrl(url),
        formatTime: () => "0:00",
      };
      vi.stubGlobal("usePodcastPlayer", () => player);
      return { player, toggle, seekBy, scrubTo };
    }

    it("plays the episode in-app instead of opening a new tab", async () => {
      const { toggle } = stubPlayer();
      state.activeItem = makePodcast({
        mediaUrl: "https://podcast.example.com/episode-1.mp3",
        url: "https://podcast.example.com/episode-1",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      await wrapper.find(".pod-play").trigger("click");

      expect(toggle).toHaveBeenCalledWith(
        "https://podcast.example.com/episode-1.mp3",
      );
      expect(window.open).not.toHaveBeenCalled();
    });

    it("disables the play button when mediaUrl is absent", async () => {
      stubPlayer();
      state.activeItem = makePodcast({
        mediaUrl: null,
        url: "https://podcast.example.com/episode-1",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".pod-play").attributes("disabled")).toBeDefined();
    });

    it("disables the play button when mediaUrl is unsafe", async () => {
      stubPlayer();
      state.activeItem = makePodcast({
        mediaUrl: "javascript:alert(1)",
        url: "https://podcast.example.com/episode-1",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".pod-play").attributes("disabled")).toBeDefined();
    });

    it("does nothing when both mediaUrl and url are absent", async () => {
      state.activeItem = makePodcast({ mediaUrl: null, url: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const playButton = wrapper.find(".pod-play");
      await playButton.trigger("click");

      expect(window.open).not.toHaveBeenCalled();
    });

    it("shows the pause affordance and live progress while playing", async () => {
      stubPlayer({ active: true, progress: 0.5 });
      state.activeItem = makePodcast({
        mediaUrl: "https://podcast.example.com/episode-1.mp3",
      }) as never;
      const wrapper = shallowMount(ReaderDetail);
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".pod-play").attributes("title")).toBe(
        "Pause episode",
      );
      expect(wrapper.find(".pod-play r-icon-stub").attributes("name")).toBe(
        "pause",
      );
      expect(wrapper.find(".scrubber i").attributes("style")).toContain(
        "width: 50%",
      );
    });

    it("skips forward via the +15s button while playing", async () => {
      const { seekBy } = stubPlayer({ active: true });
      state.activeItem = makePodcast({
        mediaUrl: "https://podcast.example.com/episode-1.mp3",
      }) as never;
      const wrapper = shallowMount(ReaderDetail);
      await wrapper.vm.$nextTick();

      const skipButton = wrapper
        .findAll("button.kbd")
        .find((button) => button.text().includes("+15s"));
      expect(skipButton).toBeDefined();
      await skipButton!.trigger("click");

      expect(seekBy).toHaveBeenCalledWith(15);
    });

    it("seeks via the scrubber with the episode media URL", async () => {
      const { scrubTo } = stubPlayer({ active: true, progress: 0.5 });
      state.activeItem = makePodcast({
        mediaUrl: "https://podcast.example.com/episode-1.mp3",
      }) as never;
      const wrapper = shallowMount(ReaderDetail);
      await wrapper.vm.$nextTick();

      await wrapper.find(".scrubber").trigger("click");

      expect(scrubTo).toHaveBeenCalledWith(
        "https://podcast.example.com/episode-1.mp3",
        expect.anything(),
      );
    });
  });

  describe("real content rendering", () => {
    it("passes the article's real content paragraphs to DetailProse", async () => {
      state.activeItem = makeArticle({
        content: "Real one.\n\nReal two.",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const prose = wrapper.findComponent(DetailProse);
      expect(prose.props("paragraphs")).toEqual(["Real one.", "Real two."]);
    });

    it("passes an empty paragraph list and honest article empty text when content is absent", async () => {
      state.activeItem = makeArticle({ content: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const prose = wrapper.findComponent(DetailProse);
      expect(prose.props("paragraphs")).toEqual([]);
      expect(prose.props("emptyText")).toContain(
        "No article text was included",
      );
    });

    it("passes the podcast's real show notes to DetailProse", async () => {
      state.activeItem = makePodcast({
        content: "Note one.\n\nNote two.",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const prose = wrapper.findComponent(DetailProse);
      expect(prose.props("paragraphs")).toEqual(["Note one.", "Note two."]);
    });

    it("passes an empty list and honest podcast empty text when content is absent", async () => {
      state.activeItem = makePodcast({ content: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const prose = wrapper.findComponent(DetailProse);
      expect(prose.props("paragraphs")).toEqual([]);
      expect(prose.props("emptyText")).toContain("No show notes were included");
    });

    it("passes the video's real description to DetailProse", async () => {
      state.activeItem = makeVideo({
        content: "Real video description.",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const prose = wrapper.findComponent(DetailProse);
      expect(prose.props("paragraphs")).toEqual(["Real video description."]);
    });

    it("passes an empty list and honest video empty text when content is absent", async () => {
      state.activeItem = makeVideo({ content: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const prose = wrapper.findComponent(DetailProse);
      expect(prose.props("paragraphs")).toEqual([]);
      expect(prose.props("emptyText")).toContain("No description was included");
    });

    it("renders the real video thumbnail from imageUrl with a formatted duration", async () => {
      state.activeItem = makeVideo({
        imageUrl: "https://example.com/v.jpg",
        mediaDuration: 754,
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const image = wrapper.find("img.thumb-img");
      expect(image.exists()).toBe(true);
      expect(image.attributes("src")).toBe("https://example.com/v.jpg");
      expect(wrapper.find(".thumb-dur").text()).toBe("12:34");
    });

    it("falls back to the striped placeholder and omits duration when the video has no image or duration", async () => {
      state.activeItem = makeVideo({
        imageUrl: null,
        mediaDuration: null,
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.find("img.thumb-img").exists()).toBe(false);
      expect(wrapper.find(".thumb").classes()).toContain("ph");
      expect(wrapper.find(".thumb-dur").exists()).toBe(false);
    });

    it("renders the real tweet body from content", async () => {
      state.activeItem = makeTweet({
        content: "The actual synced post text.",
      }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".detail-tweet").text()).toBe(
        "The actual synced post text.",
      );
    });

    it("shows an honest empty state for a tweet with no text", async () => {
      state.activeItem = makeTweet({ content: null }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.find(".detail-tweet").text()).toBe(
        "This post has no text.",
      );
    });

    it("preserves paragraph breaks in a multi-paragraph tweet body", async () => {
      state.activeItem = makeTweet({ content: "One.\n\nTwo." }) as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const body = wrapper.find(".detail-tweet").text();
      expect(body).toContain("One.");
      expect(body).toContain("Two.");
      expect(body).toContain("\n");
    });

    it("renders no fabricated replies for a tweet", async () => {
      state.activeItem = makeTweet() as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.html()).not.toContain("Replies");
      expect(wrapper.html()).not.toContain("in_the_replies");
      expect(wrapper.html()).not.toContain("ships_daily");
    });
  });

  describe("save (bookmark) button", () => {
    it("toggles saved state via feedStore.toggleSave when clicked", async () => {
      const article = makeArticle({ saved: false });
      state.activeItem = article as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const saveButton = wrapper
        .findAll(".icon-btn")
        .find((btn) => btn.attributes("title") === "Save for later");
      expect(saveButton).toBeDefined();
      await saveButton!.trigger("click");

      expect(state.activeItem?.saved).toBe(true);
    });

    it("reflects saved state in title and class", async () => {
      const article = makeArticle({ saved: true });
      state.activeItem = article as never;
      const wrapper = mountDetail();
      await wrapper.vm.$nextTick();

      const saveButton = wrapper
        .findAll(".icon-btn")
        .find((btn) => btn.attributes("title") === "Saved");
      expect(saveButton).toBeDefined();
      expect(saveButton!.classes()).toContain("on");
    });
  });
});
