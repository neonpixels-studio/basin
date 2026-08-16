// Shared tag/category normalization for every feed adapter. Feed sources expose
// tags in inconsistent shapes (plain strings, attribute-bearing objects,
// hashtag facets), so each adapter extracts a raw list and hands it here for a
// single, well-tested cleanup pass before the tags reach the GIN-indexed column.

// Cap the tags persisted per item so a pathological feed can't bloat the
// GIN-indexed tags column.
export const MAX_TAGS_PER_ITEM = 25;

// Tags longer than this are almost certainly not real tags (e.g. a whole
// sentence miscategorized); drop them to keep the column clean.
export const MAX_TAG_LENGTH = 100;

// Bound the raw values inspected so a broken feed with hundreds of thousands of
// duplicate/over-length categories on one item can't burn CPU trimming values
// that could never all be kept anyway. Generous multiple of the store cap so
// legitimate feeds are never truncated.
const MAX_VALUES_SCANNED = MAX_TAGS_PER_ITEM * 10;

// RSS/Atom <category> elements surface as plain strings, or as objects carrying
// attributes: { _: "text", $: {...} } (RSS with a domain), { $: { term } }
// (Atom), or { $: { text } } (iTunes category). Coerce any of these to text,
// preferring the first candidate that is genuinely a string (a non-string `_`
// must not shadow a valid `$.term`).
function coerceToTagText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    _?: unknown;
    $?: { term?: unknown; text?: unknown };
  };
  const candidates = [record._, record.$?.term, record.$?.text];
  const text = candidates.find((candidate) => typeof candidate === "string");
  return typeof text === "string" ? text : null;
}

// Strip a leading hashtag marker (Bluesky record.tags/facets may include it)
// so the stored value stays bare and the UI's own `#` prefix isn't doubled.
function cleanTagText(text: string): string {
  return text.trim().replace(/^#+/, "").trim();
}

// Coerce and clean a single raw value into a usable tag, or null when it yields
// nothing storable (non-string, empty after cleaning, or absurdly long).
function normalizeTag(value: unknown): string | null {
  const text = coerceToTagText(value);
  if (text === null) {
    return null;
  }

  const cleaned = cleanTagText(text);
  if (!cleaned || cleaned.length > MAX_TAG_LENGTH) {
    return null;
  }

  return cleaned;
}

// Normalize a raw list of tag values into a clean, deduped, capped array.
// Returns null when nothing usable remains so callers store SQL NULL rather
// than an empty array — the "no tags" state the UI already renders.
export function normalizeTags(
  values: readonly unknown[] | undefined | null,
): string[] | null {
  if (!values?.length) {
    return null;
  }

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of values.slice(0, MAX_VALUES_SCANNED)) {
    if (tags.length >= MAX_TAGS_PER_ITEM) {
      break;
    }

    const tag = normalizeTag(value);
    if (tag === null) {
      continue;
    }

    // Dedupe case-insensitively but preserve the first-seen casing for display.
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);
  }

  return tags.length ? tags : null;
}
