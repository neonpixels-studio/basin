import { describe, it, expect } from "vitest";
import {
  normalizeTags,
  MAX_TAGS_PER_ITEM,
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

  it("dedupes case-insensitively, preserving first-seen casing", () => {
    expect(normalizeTags(["Tech", "tech", "TECH", "news"])).toEqual([
      "Tech",
      "news",
    ]);
  });

  it("strips a leading hashtag marker", () => {
    expect(normalizeTags(["#photography", "##double"])).toEqual([
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

  it("drops absurdly long tags", () => {
    const tooLong = "a".repeat(101);
    expect(normalizeTags([tooLong, "ok"])).toEqual(["ok"]);
  });

  it("caps the number of tags at MAX_TAGS_PER_ITEM", () => {
    const many = Array.from(
      { length: MAX_TAGS_PER_ITEM + 10 },
      (_unused, i) => `tag-${i}`,
    );
    const result = normalizeTags(many);
    expect(result).toHaveLength(MAX_TAGS_PER_ITEM);
    expect(result?.[0]).toBe("tag-0");
  });
});
