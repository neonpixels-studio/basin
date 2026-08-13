// @vitest-environment jsdom
// DOMPurify relies on a spec-accurate DOM (template.content, attribute
// traversal) that the default happy-dom environment does not fully provide, so
// the sanitizer is exercised under jsdom — the environment DOMPurify officially
// supports on the Node side. This is where the security guarantees are proven;
// the store/component tests only cover the plain-text-vs-markup routing.
import { describe, it, expect } from "vitest";
import { sanitizeFeedHtml } from "~/utils/sanitizeHtml";

describe("sanitizeFeedHtml", () => {
  it("returns an empty string for non-string or blank input", () => {
    expect(sanitizeFeedHtml(null)).toBe("");
    expect(sanitizeFeedHtml(undefined)).toBe("");
    expect(sanitizeFeedHtml(42)).toBe("");
    expect(sanitizeFeedHtml("")).toBe("");
    expect(sanitizeFeedHtml("   \n  ")).toBe("");
  });

  it("preserves safe formatting markup", () => {
    const output = sanitizeFeedHtml(
      "<p>Hello <strong>world</strong> and <em>friends</em>.</p>",
    );
    expect(output).toBe(
      "<p>Hello <strong>world</strong> and <em>friends</em>.</p>",
    );
  });

  it("preserves lists and blockquotes", () => {
    const output = sanitizeFeedHtml(
      "<ul><li>One</li><li>Two</li></ul><blockquote>Quote</blockquote>",
    );
    expect(output).toContain("<ul>");
    expect(output).toContain("<li>One</li>");
    expect(output).toContain("<blockquote>Quote</blockquote>");
  });

  it("strips <script> tags and their content", () => {
    const output = sanitizeFeedHtml("<p>Safe</p><script>alert('xss')</script>");
    expect(output).not.toContain("<script");
    expect(output).not.toContain("alert");
    expect(output).toBe("<p>Safe</p>");
  });

  it("strips <style> tags and their content", () => {
    const output = sanitizeFeedHtml(
      "<style>body{display:none}</style><p>Visible</p>",
    );
    expect(output).not.toContain("<style");
    expect(output).not.toContain("display:none");
    expect(output).toBe("<p>Visible</p>");
  });

  it("strips inline event-handler attributes", () => {
    const output = sanitizeFeedHtml("<p onclick=\"alert('xss')\">Click</p>");
    expect(output).not.toContain("onclick");
    expect(output).not.toContain("alert");
    expect(output).toBe("<p>Click</p>");
  });

  it("drops javascript: URLs on links while keeping the link text", () => {
    const output = sanitizeFeedHtml(
      "<a href=\"javascript:alert('xss')\">tap</a>",
    );
    expect(output).not.toContain("javascript:");
    expect(output).not.toContain("alert");
    expect(output).toContain("tap");
  });

  it("drops data: URLs on links", () => {
    const output = sanitizeFeedHtml(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    );
    expect(output).not.toContain("data:");
    expect(output).not.toContain("alert");
    expect(output).toContain("x");
  });

  it("removes <img> carrying an onerror handler entirely", () => {
    const output = sanitizeFeedHtml('<img src="x" onerror="alert(1)" />');
    expect(output).not.toContain("onerror");
    expect(output).not.toContain("alert");
    expect(output).not.toContain("<img");
  });

  it("removes <iframe> but keeps sibling text", () => {
    const output = sanitizeFeedHtml(
      '<iframe src="https://evil.example"></iframe><p>Body</p>',
    );
    expect(output).not.toContain("<iframe");
    expect(output).toBe("<p>Body</p>");
  });

  it("keeps safe http/https links and hardens them for new-tab opening", () => {
    const output = sanitizeFeedHtml('<a href="https://example.com">site</a>');
    expect(output).toContain('href="https://example.com"');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer"');
  });

  it("keeps mailto links", () => {
    const output = sanitizeFeedHtml('<a href="mailto:hi@example.com">mail</a>');
    expect(output).toContain('href="mailto:hi@example.com"');
  });
});
