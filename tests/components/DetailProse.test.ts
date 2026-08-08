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
});
