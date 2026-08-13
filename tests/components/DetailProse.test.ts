import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DetailProse from "~/components/DetailProse.vue";

describe("DetailProse", () => {
  it("renders each real paragraph and no empty state", () => {
    const wrapper = mount(DetailProse, {
      props: {
        paragraphs: ["Real one.", "Real two."],
        emptyText: "Nothing here.",
      },
    });

    const paragraphs = wrapper.findAll("p");
    expect(paragraphs.map((paragraph) => paragraph.text())).toEqual([
      "Real one.",
      "Real two.",
    ]);
    expect(wrapper.text()).not.toContain("Nothing here.");
  });

  it("shows the honest empty text when there are no paragraphs", () => {
    const wrapper = mount(DetailProse, {
      props: { paragraphs: [], emptyText: "No content was included." },
    });

    const paragraphs = wrapper.findAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].text()).toBe("No content was included.");
    expect(paragraphs[0].classes()).toContain("text-muted");
  });

  it("renders sanitized html markup when the html prop is set", () => {
    const wrapper = mount(DetailProse, {
      props: {
        paragraphs: [],
        emptyText: "Nothing here.",
        html: "<p>Rendered <strong>markup</strong>.</p>",
      },
    });

    expect(wrapper.find("strong").exists()).toBe(true);
    expect(wrapper.html()).toContain("<strong>markup</strong>");
    expect(wrapper.text()).not.toContain("Nothing here.");
  });

  it("prefers the html prop over paragraphs and the empty state", () => {
    const wrapper = mount(DetailProse, {
      props: {
        paragraphs: ["Plain fallback."],
        emptyText: "Nothing here.",
        html: "<p>HTML wins.</p>",
      },
    });

    expect(wrapper.text()).toContain("HTML wins.");
    expect(wrapper.text()).not.toContain("Plain fallback.");
  });

  it("falls back to paragraphs when the html prop is empty", () => {
    const wrapper = mount(DetailProse, {
      props: {
        paragraphs: ["Real one."],
        emptyText: "Nothing here.",
        html: "",
      },
    });

    const paragraphs = wrapper.findAll("p");
    expect(paragraphs.map((paragraph) => paragraph.text())).toEqual([
      "Real one.",
    ]);
  });
});
