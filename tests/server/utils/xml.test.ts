import { describe, it, expect } from "vitest";
import { escapeXmlEntities } from "../../../server/utils/xml";

describe("escapeXmlEntities", () => {
  it("escapes the text-node entities", () => {
    expect(escapeXmlEntities("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes the attribute-value entities", () => {
    expect(escapeXmlEntities(`say "hi" it's fine`)).toBe(
      "say &quot;hi&quot; it&apos;s fine",
    );
  });

  it("escapes & before other entities so it never double-escapes", () => {
    // If '<' were escaped before '&', "&lt;" would become "&amp;lt;" instead
    // of the intended "&amp;lt;" for a literal "&lt;" input — this pins the
    // split/join call order.
    expect(escapeXmlEntities("&lt;")).toBe("&amp;lt;");
  });
});
