// @vitest-environment jsdom
// contentHtml runs DOMPurify, which only behaves correctly on a spec-accurate
// DOM. So the sanitized-structure assertions live here under jsdom, while the
// plain-text-vs-markup routing (which never touches DOMPurify) is covered in
// tests/composables/useFeed.test.ts under the default happy-dom environment.
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useFeedStore } from "~/stores/feed";

describe("feed store contentHtml (jsdom)", () => {
  let feed: ReturnType<typeof useFeedStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    feed = useFeedStore();
  });

  it("preserves sanitized block markup unchanged", () => {
    expect(feed.contentHtml({ content: "<p>One</p><p>Two</p>" })).toBe(
      "<p>One</p><p>Two</p>",
    );
  });

  it("preserves inline formatting inside block markup", () => {
    expect(
      feed.contentHtml({ content: "<p>Notes with <strong>bold</strong>.</p>" }),
    ).toBe("<p>Notes with <strong>bold</strong>.</p>");
  });

  it("strips dangerous markup from HTML content", () => {
    const html = feed.contentHtml({
      content: "<p>Safe</p><script>alert('xss')</script>",
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
    expect(html).toBe("<p>Safe</p>");
  });

  it("returns an empty string when markup sanitizes to nothing", () => {
    expect(feed.contentHtml({ content: "<script>alert(1)</script>" })).toBe("");
    expect(feed.contentHtml({ content: '<img src="cover.jpg">' })).toBe("");
  });

  it("wraps inline-only markup's newline-separated blocks in paragraphs", () => {
    const html = feed.contentHtml({
      content: 'First with <a href="https://x.com">link</a>\n\nSecond block',
    });
    expect(html.match(/<p>/g)?.length).toBe(2);
    expect(html).toContain('href="https://x.com"');
    expect(html).toContain("Second block");
  });

  it("wraps paragraph breaks even when the inline markup contains <br>", () => {
    const html = feed.contentHtml({
      content: "Guests:<br>Alice\n\nTopics we covered",
    });
    expect(html.match(/<p>/g)?.length).toBe(2);
    expect(html).toContain("<br>");
    expect(html).toContain("Topics we covered");
  });
});
