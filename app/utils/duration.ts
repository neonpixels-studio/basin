import { formatPlaybackTime } from "~/composables/usePodcastPlayer";

// Formats a synced item's `mediaDuration` (seconds, possibly null/non-numeric)
// into a display label, or "" when the feed carried no duration — so cards omit
// the field entirely instead of showing "0:00" or a blank slot.
export function durationLabel(mediaDuration: unknown): string {
  const seconds = Number(mediaDuration) || 0;
  return seconds > 0 ? formatPlaybackTime(seconds) : "";
}
