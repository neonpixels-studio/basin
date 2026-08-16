import { describe, it, expect } from "vitest";
import {
  normalizeTags,
  MAX_TAGS_PER_ITEM,
  MAX_TAG_LENGTH,
} from "../../../server/utils/tagNormalizer";

describe("normalizeTags", () => {
  it("returns null for null, undefined, or empty input", () => {
    expect(normalizeTags(null)).toBeNull();
    expect(normalizeTags(undefined)).toBeNull();
    expect(normalizeTags([])).toBeNull();
  });

  it("keeps plain string tags, trimmed", () => {
    expect(normalizeTags(["  tech  ", "news"])).toEqual(["tech", "news"]);
  });

  it("drops empty and whitespace-only entries", () => {
    expect(normalizeTags(["tech", "", "   ", "news"])).toEqual([
      "tech",
      "news",
    ]);
  });

  it("returns null when nothing usable remains", () => {
    expect(normalizeTags(["", "   ", "#"])).toBeNull();
  });

  it("dedupes case-insensitively, storing canonical lowercase", () => {
    expect(normalizeTags(["Tech", "tech", "TECH", "News"])).toEqual([
      "tech",
      "news",
    ]);
  });

  it("collapses internal whitespace in multi-line categories", () => {
    expect(normalizeTags(["  Web\n   Development "])).toEqual([
      "web development",
    ]);
  });

  it("strips a leading hashtag marker", () => {
    expect(normalizeTags(["#Photography", "##Double"])).toEqual([
      "photography",
      "double",
    ]);
  });

  it("coerces attribute-bearing objects (RSS _, Atom term, iTunes text)", () => {
    const values = [
      { _: "rss-text", $: { domain: "http://example.com" } },
      { $: { term: "atom-term" } },
      { $: { text: "itunes-text" } },
    ];
    expect(normalizeTags(values)).toEqual([
      "rss-text",
      "atom-term",
      "itunes-text",
    ]);
  });

  it("ignores objects with no usable text", () => {
    expect(normalizeTags([{ $: { domain: "x" } }, 42, null])).toBeNull();
  });

  it("skips a non-string _ in favour of a valid attribute", () => {
    expect(normalizeTags([{ _: 42, $: { term: "tech" } }])).toEqual(["tech"]);
  });

  it("skips an empty-string _ in favour of a valid attribute", () => {
    expect(normalizeTags([{ _: "", $: { term: "tech" } }])).toEqual(["tech"]);
  });

  it("drops absurdly long tags", () => {
    const tooLong = "a".repeat(MAX_TAG_LENGTH + 1);
    expect(normalizeTags([tooLong, "ok"])).toEqual(["ok"]);
  });

  it("keeps a tag of exactly MAX_TAG_LENGTH, measured after cleaning", () => {
    const exact = "a".repeat(MAX_TAG_LENGTH);
    // Padded with a hash and whitespace that cleaning removes before the length
    // check, proving the check runs on the cleaned text.
    expect(normalizeTags([`  #${exact}  `])).toEqual([exact]);
  });

  it("strips control characters (e.g. NUL) that Postgres would reject", () => {
    const withNul = `te${String.fromCharCode(0)}ch`;
    expect(normalizeTags([withNul, "valid"])).toEqual(["tech", "valid"]);
  });

  it("returns null for a bare string instead of splitting it into characters", () => {
    expect(normalizeTags("tech" as unknown as string[])).toBeNull();
  });

  it("caps the number of tags at MAX_TAGS_PER_ITEM", () => {
    const many = Array.from(
      { length: MAX_TAGS_PER_ITEM + 10 },
      (_element, index) => `tag-${index}`,
    );
    const result = normalizeTags(many);
    expect(result).toHaveLength(MAX_TAGS_PER_ITEM);
    expect(result?.[0]).toBe("tag-0");
  });
});
