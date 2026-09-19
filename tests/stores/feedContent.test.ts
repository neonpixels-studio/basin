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

  it("keeps div-separated blocks as separate sibling elements", () => {
    const html = feed.contentHtml({
      content: "<div>Para one</div><div>Para two</div>",
    });
    const fragment = document.createElement("div");
    fragment.innerHTML = html;
    const blocks = [...fragment.children].filter(
      (child) => child.tagName === "DIV",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toBe("Para one");
    expect(blocks[1].textContent).toBe("Para two");
  });

  it("preserves a multi-line list split by blank lines instead of tearing it apart", () => {
    const html = feed.contentHtml({
      content: "<ul>\n<li>One</li>\n\n<li>Two</li>\n</ul>",
    });
    const fragment = document.createElement("div");
    fragment.innerHTML = html;
    const listItems = fragment.querySelectorAll("ul > li");
    expect(listItems).toHaveLength(2);
    expect(listItems[0].textContent).toBe("One");
    expect(listItems[1].textContent).toBe("Two");
  });

  it("preserves table structure from newsletter-style content", () => {
    const html = feed.contentHtml({
      content: "<table><tr><td>Mon</td><td>Standup</td></tr></table>",
    });
    const fragment = document.createElement("div");
    fragment.innerHTML = html;
    const cells = fragment.querySelectorAll("table td");
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("Mon");
    expect(cells[1].textContent).toBe("Standup");
  });

  it("preserves whitespace and newlines inside a <pre> block", () => {
    const html = feed.contentHtml({
      content: "<pre>line one\nline two</pre>",
    });
    expect(html).toContain("line one\nline two");
  });

  it("drops blocks that sanitize to nothing instead of leaving empty paragraphs", () => {
    const html = feed.contentHtml({
      content: "Intro\n\n<script>alert(1)</script>\n\nOutro",
    });
    expect(html).toBe("<p>Intro</p><p>Outro</p>");
  });

  it("renders less common but real HTML tags instead of showing them as source", () => {
    const html = feed.contentHtml({
      content: "<article>The full post text.</article>",
    });
    expect(html).not.toContain("&lt;article&gt;");
    expect(html).toContain("The full post text.");
    expect(feed.contentParagraphs({ content: "<article>x</article>" })).toEqual(
      [],
    );
  });
});
