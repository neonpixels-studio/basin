import { describe, it, expect } from "vitest";
import { shallowMount } from "@vue/test-utils";
import CardActions from "~/components/CardActions.vue";
import { makeArticle } from "../fixtures";

describe("CardActions", () => {
  it("renders save, star and open buttons", () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle({ saved: false }) },
    });
    expect(wrapper.findAll("button")).toHaveLength(3);
  });

  it("emits save on save button click", async () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle() },
    });
    await wrapper.findAll("button")[0].trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
  });

  it("emits star on star button click", async () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle() },
    });
    await wrapper.findAll("button")[1].trigger("click");
    expect(wrapper.emitted("star")).toHaveLength(1);
  });

  it("emits open on open button click", async () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle() },
    });
    await wrapper.findAll("button")[2].trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("renders the filled star icon when the item is starred", () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle({ starred: true }) },
    });
    const starButton = wrapper.findAll("button")[1];
    expect(starButton.classes()).toContain("on");
    expect(starButton.attributes("title")).toBe("Starred");
  });

  it("renders the outline star icon when the item is not starred", () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle({ starred: false }) },
    });
    const starButton = wrapper.findAll("button")[1];
    expect(starButton.classes()).not.toContain("on");
    expect(starButton.attributes("title")).toBe("Star");
  });

  it("matches snapshot (unsaved)", () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle({ saved: false }) },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (saved)", () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle({ saved: true }) },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot (starred)", () => {
    const wrapper = shallowMount(CardActions, {
      props: { item: makeArticle({ starred: true }) },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
