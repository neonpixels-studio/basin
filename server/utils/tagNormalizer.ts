// Shared tag/category normalization for every feed adapter. Feed sources expose
// tags in inconsistent shapes (plain strings, attribute-bearing objects,
// hashtag facets), so each adapter extracts a raw list and hands it here for a
// single, well-tested cleanup pass before the tags reach the GIN-indexed column.

// Cap the tags persisted per item so a pathological feed can't bloat the
// GIN-indexed tags column.
export const MAX_TAGS_PER_ITEM = 25;

// Tags longer than this are almost certainly not real tags (e.g. a whole
// sentence miscategorized); drop them to keep the column clean.
const MAX_TAG_LENGTH = 100;

// RSS/Atom <category> elements surface as plain strings, or as objects carrying
// attributes: { _: "text", $: {...} } (RSS with a domain), { $: { term } }
// (Atom), or { $: { text } } (iTunes category). Coerce any of these to text.
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
  const candidate = record._ ?? record.$?.term ?? record.$?.text;
  return typeof candidate === "string" ? candidate : null;
}

// Strip a leading hashtag marker (Bluesky record.tags/facets may include it)
// so the stored value stays bare and the UI's own `#` prefix isn't doubled.
function cleanTagText(text: string): string {
  return text.trim().replace(/^#+/, "").trim();
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

  for (const value of values) {
    if (tags.length >= MAX_TAGS_PER_ITEM) {
      break;
    }

    const text = coerceToTagText(value);
    if (text === null) {
      continue;
    }

    const cleaned = cleanTagText(text);
    if (!cleaned || cleaned.length > MAX_TAG_LENGTH) {
      continue;
    }

    // Dedupe case-insensitively but preserve the first-seen casing.
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(cleaned);
  }

  return tags.length ? tags : null;
}
