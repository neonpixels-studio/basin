import { describe, it, expect } from "vitest";
import { contentText } from "~/utils/itemContent";

describe("contentText", () => {
  it("returns an empty string for null/undefined/non-string content", () => {
    expect(contentText(null)).toBe("");
    expect(contentText(undefined)).toBe("");
    expect(contentText(42)).toBe("");
  });

  it("collapses hard and soft newlines into single spaces", () => {
    expect(contentText("First paragraph.\n\nSecond paragraph.")).toBe(
      "First paragraph. Second paragraph.",
    );
    expect(contentText("wrapped\nline")).toBe("wrapped line");
  });

  it("trims surrounding whitespace", () => {
    expect(contentText("  \n  padded  \n ")).toBe("padded");
  });

  it("returns an empty string for whitespace-only content", () => {
    expect(contentText("   \n\t  ")).toBe("");
  });

  it("strips HTML tags and decodes entities from feed content", () => {
    expect(contentText("<p>One.</p><p>Two &amp; three.</p>")).toBe(
      "One. Two & three.",
    );
    expect(contentText("In this episode&#8230; we <b>talk</b>")).toBe(
      "In this episode… we talk",
    );
    expect(contentText("a &lt;tag&gt; &#x27;quoted&#x27;")).toBe(
      "a <tag> 'quoted'",
    );
  });
});
