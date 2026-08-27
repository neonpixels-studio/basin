// Relative time tokens from formatRelativeTime look like "30m", "2h", "3d";
// anything else (e.g. "Aug 5") is an absolute date for older items.
const RELATIVE_TIME_PATTERN = /^\d+[mhd]$/;

export function isRelativeTime(time: string): boolean {
  return RELATIVE_TIME_PATTERN.test(time);
}

// Appends " ago" only to relative tokens, so "2h" reads "2h ago" while an
// absolute date like "Aug 5" renders unchanged (never "Aug 5 ago").
export function readerTimeLabel(time: string | null | undefined): string {
  if (!time) return "";
  return isRelativeTime(time) ? `${time} ago` : time;
}
