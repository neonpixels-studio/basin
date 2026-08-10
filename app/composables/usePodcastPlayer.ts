import { reactive, computed } from "vue";

// Advance/rewind step for the skip control, in seconds.
export const SEEK_STEP_SECONDS = 15;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const PLAYABLE_PROTOCOLS = ["https:", "http:"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isPlayableUrl(url: string | null | undefined): url is string {
  if (!url) {
    return false;
  }
  try {
    return PLAYABLE_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function formatPlaybackTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0:00";
  }
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = whole % SECONDS_PER_MINUTE;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

// Returns the click position as a 0-1 fraction of the bar's width, or null
// when the bar cannot be measured (so callers can distinguish "unmeasurable"
// from a genuine seek to the very start).
export function pointerFraction(event: MouseEvent): number | null {
  const target = event.currentTarget as HTMLElement | null;
  const bounds = target?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0) {
    return null;
  }
  return clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
}

export interface PodcastPlayerState {
  currentUrl: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
}

// Wires reactive state to a single media element. The element is injected so
// the control logic can be unit-tested against a mock in isolation.
export function createPodcastPlayer(audio: HTMLMediaElement) {
  const state = reactive<PodcastPlayerState>({
    currentUrl: null,
    playing: false,
    currentTime: 0,
    duration: 0,
  });

  audio.addEventListener("timeupdate", () => {
    state.currentTime = audio.currentTime;
  });
  audio.addEventListener("durationchange", () => {
    state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  });
  audio.addEventListener("play", () => {
    state.playing = true;
  });
  audio.addEventListener("pause", () => {
    state.playing = false;
  });
  audio.addEventListener("ended", () => {
    state.playing = false;
    state.currentTime = 0;
    audio.currentTime = 0;
  });
  audio.addEventListener("error", () => {
    state.playing = false;
  });

  // Only clears the flag when the failed attempt is still the current episode,
  // so a late rejection from a previous episode can't stop a newer one.
  function failPlaybackFor(url: string): void {
    if (state.currentUrl !== url) {
      return;
    }
    state.playing = false;
  }

  const progress = computed(() => {
    if (state.duration <= 0) {
      return 0;
    }
    return clamp(state.currentTime / state.duration, 0, 1);
  });

  function isActive(url: string | null | undefined): boolean {
    return !!url && state.currentUrl === url;
  }

  function isPlaying(url: string | null | undefined): boolean {
    return isActive(url) && state.playing;
  }

  function canPlay(url: string | null | undefined): boolean {
    return isPlayableUrl(url);
  }

  function play(url: string | null | undefined): void {
    if (!isPlayableUrl(url)) {
      return;
    }
    if (state.currentUrl !== url) {
      state.currentUrl = url;
      state.currentTime = 0;
      state.duration = 0;
      audio.src = url;
    }
    // audio.play() rejects on autoplay blocks and load/network errors; swallow
    // nothing — reset the playing flag so the UI never sticks on "playing".
    Promise.resolve(audio.play()).catch(() => failPlaybackFor(url));
  }

  function pause(): void {
    audio.pause();
  }

  function toggle(url: string | null | undefined): void {
    if (isPlaying(url)) {
      pause();
      return;
    }
    play(url);
  }

  function seekToFraction(fraction: number): void {
    if (state.duration <= 0) {
      return;
    }
    const target = clamp(fraction, 0, 1) * state.duration;
    audio.currentTime = target;
    state.currentTime = target;
  }

  function seekBy(seconds: number): void {
    if (state.duration <= 0) {
      return;
    }
    const target = clamp(state.currentTime + seconds, 0, state.duration);
    audio.currentTime = target;
    state.currentTime = target;
  }

  // Seeks from a click on a progress bar, but only when the click belongs to
  // the episode that is actually loaded — guarding here keeps every consumer
  // from re-implementing the same check and accidentally seeking the wrong
  // episode.
  function scrubTo(url: string | null | undefined, event: MouseEvent): void {
    if (!isActive(url)) {
      return;
    }
    const fraction = pointerFraction(event);
    if (fraction === null) {
      return;
    }
    seekToFraction(fraction);
  }

  return reactive({
    state,
    progress,
    seekStep: SEEK_STEP_SECONDS,
    play,
    pause,
    toggle,
    seekBy,
    seekToFraction,
    scrubTo,
    isActive,
    isPlaying,
    canPlay,
    formatTime: formatPlaybackTime,
  });
}

export type PodcastPlayer = ReturnType<typeof createPodcastPlayer>;

function createInertAudio(): HTMLMediaElement {
  return {
    src: "",
    currentTime: 0,
    duration: 0,
    paused: true,
    addEventListener() {},
    removeEventListener() {},
    play() {
      return Promise.resolve();
    },
    pause() {},
  } as unknown as HTMLMediaElement;
}

let sharedPlayer: PodcastPlayer | null = null;

// App-wide singleton so one episode plays at a time and progress is shared
// between the card and the reader detail. The owned <audio> element persists
// across component mounts, which is what keeps playback going during navigation.
export function usePodcastPlayer(): PodcastPlayer {
  if (!import.meta.client) {
    // Per-request inert player on the server so no playback state leaks
    // between concurrent SSR requests through the module singleton.
    return createPodcastPlayer(createInertAudio());
  }
  if (!sharedPlayer) {
    sharedPlayer = createPodcastPlayer(new Audio());
  }
  return sharedPlayer;
}
