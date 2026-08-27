// Relative time tokens from formatRelativeTime look like "30m", "2h", "3d";
// anything else (e.g. "Aug 5") is an absolute date for older items.
const RELATIVE_TIME_PATTERN = /^\d+[mhd]$/;

const RELATIVE_WINDOW_DAYS = 7;

// Formats a Date into a short time string: a relative token ("2h", "3d") within
// the last week, otherwise an absolute date ("Aug 5"). Producer for the `time`
// field on feed items; kept next to isRelativeTime so the two shapes stay bound.
export function formatRelativeTime(date: Date | null): string {
  if (!date) {
    return "";
  }

  // Clamp to 0 so a future-dated item (timezone-skewed RSS pubDates,
  // publish-ahead scheduling) floors at "0m" instead of a negative token
  // like "-125m", which the relative-time pattern would misread as an
  // absolute date.
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  if (diffDays < RELATIVE_WINDOW_DAYS) {
    return `${diffDays}d`;
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function isRelativeTime(time: string): boolean {
  return RELATIVE_TIME_PATTERN.test(time);
}

// Appends " ago" only to relative tokens, so "2h" reads "2h ago" while an
// absolute date like "Aug 5" renders unchanged (never "Aug 5 ago").
export function readerTimeLabel(time: string | null | undefined): string {
  if (!time) {
    return "";
  }
  return isRelativeTime(time) ? `${time} ago` : time;
}
