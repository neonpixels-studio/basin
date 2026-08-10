import { describe, it, expect, vi, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import PodcastCard from "~/components/PodcastCard.vue";
import {
  isPlayableUrl,
  formatPlaybackTime,
} from "~/composables/usePodcastPlayer";
import { makePodcast } from "../fixtures";

// Stub the shared player so play control is asserted without a real <audio>;
// canPlay uses the genuine URL-safety check to drive the disabled state.
function stubPlayer(overrides: { active?: boolean; progress?: number } = {}) {
  const active = overrides.active ?? false;
  const toggle = vi.fn();
  const scrubTo = vi.fn();
  const player = {
    state: { currentUrl: null, playing: active, currentTime: 0, duration: 0 },
    progress: overrides.progress ?? 0,
    seekStep: 15,
    play: vi.fn(),
    pause: vi.fn(),
    toggle,
    seekBy: vi.fn(),
    seekToFraction: vi.fn(),
    scrubTo,
    isActive: () => active,
    isPlaying: () => active,
    canPlay: (url: string | null) => isPlayableUrl(url),
    formatTime: formatPlaybackTime,
  };
  vi.stubGlobal("usePodcastPlayer", () => player);
  return { player, toggle, scrubTo };
}

describe("PodcastCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders correctly", () => {
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast() },
    });
    expect(wrapper.html()).toBeTruthy();
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast() },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("toggles in-app playback with the episode media URL", async () => {
    const { toggle } = stubPlayer();
    const wrapper = shallowMount(PodcastCard, {
      props: {
        item: makePodcast({
          mediaUrl: "https://podcast.example.com/episode-1.mp3",
        }),
      },
    });

    await wrapper.find(".pod-play").trigger("click");

    expect(toggle).toHaveBeenCalledWith(
      "https://podcast.example.com/episode-1.mp3",
    );
  });

  it("disables the play button when there is no media URL", () => {
    stubPlayer();
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast({ mediaUrl: null }) },
    });

    expect(wrapper.find(".pod-play").attributes("disabled")).toBeDefined();
  });

  it("shows the pause affordance and live progress while playing", () => {
    stubPlayer({ active: true, progress: 0.5 });
    const wrapper = shallowMount(PodcastCard, {
      props: {
        item: makePodcast({
          mediaUrl: "https://podcast.example.com/episode-1.mp3",
        }),
      },
    });

    expect(wrapper.find(".pod-play").attributes("title")).toBe("Pause episode");
    expect(wrapper.find(".pod-play r-icon-stub").attributes("name")).toBe(
      "pause",
    );
    expect(wrapper.find(".pod-bar i").attributes("style")).toContain(
      "width: 50%",
    );
  });

  it("shows the total duration formatted from mediaDuration when idle", () => {
    stubPlayer();
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast({ mediaDuration: 3661 }) },
    });

    expect(wrapper.find(".pod-dur").text()).toBe("1:01:01");
  });

  it("shows an empty duration when idle with no mediaDuration (no meta fallback)", () => {
    stubPlayer();
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast({ mediaDuration: null }) },
    });

    expect(wrapper.find(".pod-dur").text()).toBe("");
  });

  it("renders an excerpt derived from the synced content field", () => {
    stubPlayer();
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast({ content: "Note one.\n\nNote two." }) },
    });

    expect(wrapper.find(".card-excerpt").text()).toBe("Note one. Note two.");
  });

  it("does not render mock-only fields (excerpt/meta)", () => {
    stubPlayer();
    const wrapper = shallowMount(PodcastCard, {
      props: { item: makePodcast({ content: "Body." }) },
    });

    expect(wrapper.html()).not.toContain("undefined");
  });

  it("seeks via the progress bar with the episode media URL", async () => {
    const { scrubTo } = stubPlayer({ active: true, progress: 0.5 });
    const wrapper = shallowMount(PodcastCard, {
      props: {
        item: makePodcast({
          mediaUrl: "https://podcast.example.com/episode-1.mp3",
        }),
      },
    });

    await wrapper.find(".pod-bar").trigger("click");

    expect(scrubTo).toHaveBeenCalledWith(
      "https://podcast.example.com/episode-1.mp3",
      expect.anything(),
    );
  });
});
