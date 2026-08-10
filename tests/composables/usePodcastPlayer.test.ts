import { describe, it, expect, vi } from "vitest";
import {
  createPodcastPlayer,
  formatPlaybackTime,
  isPlayableUrl,
  pointerFraction,
  SEEK_STEP_SECONDS,
} from "~/composables/usePodcastPlayer";

// Minimal stand-in for HTMLMediaElement that records event listeners so tests
// can fire media events by hand — mirrors the IntersectionObserver mock style.
function makeMockAudio() {
  const listeners: Record<string, () => void> = {};
  const audio = {
    src: "",
    currentTime: 0,
    duration: NaN,
    paused: true,
    play: vi.fn(() => {
      audio.paused = false;
      listeners.play?.();
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      audio.paused = true;
      listeners.pause?.();
    }),
    addEventListener(name: string, handler: () => void) {
      listeners[name] = handler;
    },
    removeEventListener() {},
  };
  function fire(name: string) {
    listeners[name]?.();
  }
  return { audio: audio as unknown as HTMLMediaElement, raw: audio, fire };
}

const EPISODE_URL = "https://podcast.example.com/episode-1.mp3";
const OTHER_URL = "https://podcast.example.com/episode-2.mp3";

describe("isPlayableUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isPlayableUrl("https://a.com/x.mp3")).toBe(true);
    expect(isPlayableUrl("http://a.com/x.mp3")).toBe(true);
  });

  it("rejects empty, unsafe, and malformed URLs", () => {
    expect(isPlayableUrl(null)).toBe(false);
    expect(isPlayableUrl(undefined)).toBe(false);
    expect(isPlayableUrl("")).toBe(false);
    expect(isPlayableUrl("javascript:alert(1)")).toBe(false);
    expect(isPlayableUrl("not a url")).toBe(false);
  });
});

describe("formatPlaybackTime", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(9)).toBe("0:09");
    expect(formatPlaybackTime(75)).toBe("1:15");
    expect(formatPlaybackTime(2700)).toBe("45:00");
  });

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatPlaybackTime(3661)).toBe("1:01:01");
  });

  it("guards against invalid input", () => {
    expect(formatPlaybackTime(NaN)).toBe("0:00");
    expect(formatPlaybackTime(-5)).toBe("0:00");
  });
});

function makePointerEvent(
  clientX: number,
  bounds: { left: number; width: number } | null,
): MouseEvent {
  return {
    clientX,
    currentTarget: bounds
      ? {
          getBoundingClientRect: () => ({
            left: bounds.left,
            width: bounds.width,
          }),
        }
      : null,
  } as unknown as MouseEvent;
}

describe("pointerFraction", () => {
  it("returns the click position as a 0-1 fraction of the bar width", () => {
    expect(
      pointerFraction(makePointerEvent(60, { left: 10, width: 200 })),
    ).toBe(0.25);
  });

  it("clamps clicks outside the bar into range", () => {
    expect(pointerFraction(makePointerEvent(5, { left: 10, width: 200 }))).toBe(
      0,
    );
    expect(
      pointerFraction(makePointerEvent(500, { left: 10, width: 200 })),
    ).toBe(1);
  });

  it("returns null when the bar cannot be measured", () => {
    expect(pointerFraction(makePointerEvent(10, null))).toBeNull();
    expect(
      pointerFraction(makePointerEvent(10, { left: 0, width: 0 })),
    ).toBeNull();
  });
});

describe("createPodcastPlayer", () => {
  it("starts idle", () => {
    const { audio } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    expect(player.state.playing).toBe(false);
    expect(player.state.currentUrl).toBeNull();
    expect(player.progress).toBe(0);
  });

  it("plays a playable URL and sets it as the source", () => {
    const { audio, raw } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    expect(raw.src).toBe(EPISODE_URL);
    expect(raw.play).toHaveBeenCalledOnce();
    expect(player.state.currentUrl).toBe(EPISODE_URL);
    expect(player.state.playing).toBe(true);
  });

  it("ignores an unplayable URL", () => {
    const { audio, raw } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play("javascript:alert(1)");
    expect(raw.play).not.toHaveBeenCalled();
    expect(player.state.currentUrl).toBeNull();
  });

  it("toggles pause and resume for the active episode", () => {
    const { audio, raw } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    player.toggle(EPISODE_URL);
    expect(raw.pause).toHaveBeenCalledOnce();
    expect(player.state.playing).toBe(false);
    player.toggle(EPISODE_URL);
    expect(player.state.playing).toBe(true);
  });

  it("reports active and playing state per URL", () => {
    const { audio } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    expect(player.isActive(EPISODE_URL)).toBe(true);
    expect(player.isPlaying(EPISODE_URL)).toBe(true);
    expect(player.isActive("https://other.com/x.mp3")).toBe(false);
    expect(player.isPlaying("https://other.com/x.mp3")).toBe(false);
  });

  it("tracks currentTime and duration from media events", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    raw.duration = 100;
    fire("durationchange");
    raw.currentTime = 40;
    fire("timeupdate");
    expect(player.state.duration).toBe(100);
    expect(player.state.currentTime).toBe(40);
    expect(player.progress).toBe(0.4);
  });

  it("ignores a non-finite duration", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    raw.duration = Infinity;
    fire("durationchange");
    expect(player.state.duration).toBe(0);
  });

  it("resets state and the element position on ended", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    raw.currentTime = 90;
    fire("timeupdate");
    fire("ended");
    expect(player.state.playing).toBe(false);
    expect(player.state.currentTime).toBe(0);
    expect(raw.currentTime).toBe(0);
  });

  it("clears the playing flag when the media element errors", () => {
    const { audio, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    fire("play");
    expect(player.state.playing).toBe(true);
    fire("error");
    expect(player.state.playing).toBe(false);
  });

  it("clears the playing flag when play() is rejected", async () => {
    const { audio, raw, fire } = makeMockAudio();
    raw.play = vi.fn(() => Promise.reject(new Error("blocked")));
    const player = createPodcastPlayer(audio);
    fire("play"); // element briefly reports playing before the promise settles
    player.play(EPISODE_URL);
    await Promise.resolve();
    await Promise.resolve();
    expect(player.state.playing).toBe(false);
  });

  it("switches source and resets position for a different episode", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    raw.duration = 100;
    fire("durationchange");
    raw.currentTime = 40;
    fire("timeupdate");
    player.play(OTHER_URL);
    expect(raw.src).toBe(OTHER_URL);
    expect(player.state.currentTime).toBe(0);
    expect(player.state.duration).toBe(0);
    expect(player.isActive(EPISODE_URL)).toBe(false);
  });

  it("ignores a stale rejection from a superseded episode", async () => {
    const { audio, raw, fire } = makeMockAudio();
    let rejectFirst: (_reason?: unknown) => void = () => {};
    raw.play = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => (rejectFirst = reject)),
      )
      .mockImplementationOnce(() => Promise.resolve());
    const player = createPodcastPlayer(audio);

    player.play(EPISODE_URL);
    player.play(OTHER_URL);
    fire("play"); // the second episode is now playing
    rejectFirst(new Error("blocked"));
    await Promise.resolve();
    await Promise.resolve();

    expect(player.state.playing).toBe(true);
    expect(player.isActive(OTHER_URL)).toBe(true);
  });

  it("seeks by a fraction of the duration", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    raw.duration = 200;
    fire("durationchange");
    player.seekToFraction(0.5);
    expect(raw.currentTime).toBe(100);
    expect(player.state.currentTime).toBe(100);
  });

  it("clamps a relative seek within bounds", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    raw.duration = 30;
    fire("durationchange");
    raw.currentTime = 20;
    fire("timeupdate");
    player.seekBy(SEEK_STEP_SECONDS);
    expect(player.state.currentTime).toBe(30);
  });

  it("does not seek before duration is known", () => {
    const { audio, raw } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.seekBy(SEEK_STEP_SECONDS);
    player.seekToFraction(0.5);
    expect(raw.currentTime).toBe(0);
  });

  it("seeks the active episode from a pointer event via scrubTo", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    raw.duration = 100;
    fire("durationchange");
    player.scrubTo(
      EPISODE_URL,
      makePointerEvent(110, { left: 10, width: 200 }),
    );
    expect(player.state.currentTime).toBe(50);
  });

  it("does not scrub when the URL is not the active episode", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    raw.duration = 100;
    fire("durationchange");
    player.scrubTo(
      "https://other.com/x.mp3",
      makePointerEvent(110, { left: 10, width: 200 }),
    );
    expect(player.state.currentTime).toBe(0);
  });

  it("does not scrub when the bar cannot be measured", () => {
    const { audio, raw, fire } = makeMockAudio();
    const player = createPodcastPlayer(audio);
    player.play(EPISODE_URL);
    raw.duration = 100;
    fire("durationchange");
    player.scrubTo(EPISODE_URL, makePointerEvent(110, null));
    expect(player.state.currentTime).toBe(0);
  });
});
