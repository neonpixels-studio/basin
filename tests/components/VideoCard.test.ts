import { describe, it, expect, beforeEach, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { useAppearanceStore } from "~/stores/appearance";
import VideoCard from "~/components/VideoCard.vue";
import { makeVideo } from "../fixtures";

const VIDEO_URL = "https://example.com/preview.mp4";

describe("VideoCard", () => {
  let appearanceStore: ReturnType<typeof useAppearanceStore>;

  beforeEach(() => {
    // setup.ts creates a fresh Pinia before each test — get the store here
    // so it shares the same instance the component will use.
    appearanceStore = useAppearanceStore();
    appearanceStore.state.autoplay = false;
  });

  it("renders correctly", () => {
    const wrapper = shallowMount(VideoCard, { props: { item: makeVideo() } });
    expect(wrapper.html()).toBeTruthy();
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(VideoCard, { props: { item: makeVideo() } });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the real thumbnail from imageUrl with no placeholder label", () => {
    const wrapper = shallowMount(VideoCard, {
      props: { item: makeVideo({ imageUrl: "https://example.com/t.jpg" }) },
    });
    const image = wrapper.find("img.thumb-img");
    expect(image.exists()).toBe(true);
    expect(image.attributes("src")).toBe("https://example.com/t.jpg");
    expect(wrapper.find(".thumb").attributes("data-label")).toBeUndefined();
  });

  it("falls back to the striped placeholder with a 'video' label when imageUrl is absent", () => {
    const wrapper = shallowMount(VideoCard, {
      props: { item: makeVideo({ imageUrl: null }) },
    });
    expect(wrapper.find("img.thumb-img").exists()).toBe(false);
    expect(wrapper.find(".thumb").classes()).toContain("ph");
    expect(wrapper.find(".thumb").attributes("data-label")).toBe("video");
  });

  it("renders the duration formatted from mediaDuration", () => {
    const wrapper = shallowMount(VideoCard, {
      props: { item: makeVideo({ mediaDuration: 754 }) },
    });
    expect(wrapper.find(".thumb-dur").text()).toBe("12:34");
  });

  it("renders no duration label when mediaDuration is absent", () => {
    const wrapper = shallowMount(VideoCard, {
      props: { item: makeVideo({ mediaDuration: null }) },
    });
    expect(wrapper.find(".thumb-dur").exists()).toBe(false);
  });

  it("renders no card-meta slot (the mock-only views field is gone)", () => {
    const wrapper = shallowMount(VideoCard, { props: { item: makeVideo() } });
    expect(wrapper.find(".card-meta").exists()).toBe(false);
  });

  it("falls back to the placeholder when the thumbnail image fails to load", async () => {
    const wrapper = shallowMount(VideoCard, {
      props: {
        item: makeVideo({ imageUrl: "https://example.com/broken.jpg" }),
      },
    });
    await wrapper.find("img.thumb-img").trigger("error");
    expect(wrapper.find("img.thumb-img").exists()).toBe(false);
    expect(wrapper.find(".thumb").classes()).toContain("ph");
  });

  it("restores the thumbnail when the instance is reused for a new item image", async () => {
    const wrapper = shallowMount(VideoCard, {
      props: {
        item: makeVideo({ imageUrl: "https://example.com/broken.jpg" }),
      },
    });
    await wrapper.find("img.thumb-img").trigger("error");
    expect(wrapper.find("img.thumb-img").exists()).toBe(false);

    await wrapper.setProps({
      item: makeVideo({ id: 99, imageUrl: "https://example.com/ok.jpg" }),
    });
    expect(wrapper.find("img.thumb-img").exists()).toBe(true);
  });

  describe("autoplay wiring", () => {
    it("renders a video element when autoplay is off and item has a mediaUrl", () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      expect(wrapper.find("video").exists()).toBe(true);
    });

    it("shows controls when autoplay is off so the user can play manually", () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      expect(wrapper.find("video").attributes("controls")).toBeDefined();
    });

    it("hides controls when autoplay is on", () => {
      appearanceStore.state.autoplay = true;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      expect(wrapper.find("video").attributes("controls")).toBeUndefined();
    });

    it("does not render a video element when autoplay is on but item has no mediaUrl", () => {
      appearanceStore.state.autoplay = true;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo() },
      });
      expect(wrapper.find("video").exists()).toBe(false);
    });

    it("does not render a video element when autoplay is off and item has no mediaUrl", () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo() },
      });
      expect(wrapper.find("video").exists()).toBe(false);
    });

    it("renders a video element with muted and playsinline when autoplay is on and item has a mediaUrl", () => {
      appearanceStore.state.autoplay = true;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      const video = wrapper.find("video");
      expect(video.exists()).toBe(true);
      expect((video.element as HTMLVideoElement).muted).toBe(true);
      expect(video.attributes("playsinline")).toBeDefined();
      expect(video.attributes("src")).toBe(VIDEO_URL);
    });

    it("renders a video element with the correct src regardless of autoplay setting", () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      expect(wrapper.find("video").attributes("src")).toBe(VIDEO_URL);
    });

    it("does not call play on mouseenter when autoplay is off", async () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      const video = wrapper.find("video").element as HTMLVideoElement;
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      await wrapper.find("article").trigger("mouseenter");
      expect(playSpy).not.toHaveBeenCalled();
    });

    it("calls play on mouseenter when autoplay is on", async () => {
      appearanceStore.state.autoplay = true;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      const video = wrapper.find("video").element as HTMLVideoElement;
      const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);
      await wrapper.find("article").trigger("mouseenter");
      expect(playSpy).toHaveBeenCalled();
    });

    it("does not pause/reset on mouseleave when autoplay is off", async () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      const video = wrapper.find("video").element as HTMLVideoElement;
      const pauseSpy = vi.spyOn(video, "pause");
      await wrapper.find("article").trigger("mouseleave");
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it("pauses and resets on mouseleave when autoplay is on", async () => {
      appearanceStore.state.autoplay = true;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      const video = wrapper.find("video").element as HTMLVideoElement;
      const pauseSpy = vi.spyOn(video, "pause");
      video.currentTime = 12;
      await wrapper.find("article").trigger("mouseleave");
      expect(pauseSpy).toHaveBeenCalled();
      expect(video.currentTime).toBe(0);
    });

    it("video is not aria-hidden when autoplay is off", () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      expect(wrapper.find("video").attributes("aria-hidden")).toBeUndefined();
    });

    it("video is aria-hidden when autoplay is on", () => {
      appearanceStore.state.autoplay = true;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      expect(wrapper.find("video").attributes("aria-hidden")).toBe("true");
    });

    it("video click does not emit open when autoplay is off", async () => {
      appearanceStore.state.autoplay = false;
      const wrapper = shallowMount(VideoCard, {
        props: { item: makeVideo({ mediaUrl: VIDEO_URL }) },
      });
      await wrapper.find("video").trigger("click");
      expect(wrapper.emitted("open")).toBeFalsy();
    });
  });

  it("re-emits star from the card actions", async () => {
    const wrapper = shallowMount(VideoCard, { props: { item: makeVideo() } });
    wrapper.findComponent({ name: "CardActions" }).vm.$emit("star");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("star")).toHaveLength(1);
  });
});
