import { describe, it, expect } from "vitest";
import { shallowMount } from "@vue/test-utils";
import ArticleCard from "~/components/ArticleCard.vue";
import { makeArticle } from "../fixtures";

describe("ArticleCard", () => {
  const item = makeArticle();

  it("renders title and an excerpt derived from the synced content field", () => {
    const wrapper = shallowMount(ArticleCard, { props: { item } });
    expect(wrapper.find(".card-title").text()).toBe(item.title);
    // Real feeds return `content` (never `excerpt`); paragraphs collapse to one line.
    expect(wrapper.find(".card-excerpt").text()).toBe(
      "First paragraph. Second paragraph.",
    );
  });

  it("renders no excerpt when the synced item has no content", () => {
    const wrapper = shallowMount(ArticleCard, {
      props: { item: makeArticle({ content: null }) },
    });
    expect(wrapper.find(".card-excerpt").exists()).toBe(false);
  });

  it("renders no card-meta slot (the mock-only read-time field is gone)", () => {
    const wrapper = shallowMount(ArticleCard, {
      props: { item: makeArticle({ content: "Real body." }) },
    });
    expect(wrapper.find(".card-meta").exists()).toBe(false);
  });

  it("omits the footer entirely when the item has no tags", () => {
    // Adapters write tags: null for most feeds, so this is the common path.
    const wrapper = shallowMount(ArticleCard, {
      props: { item: makeArticle({ tags: null }) },
    });
    expect(wrapper.find(".card-foot").exists()).toBe(false);
  });

  it("applies unread class when item is unread", () => {
    const wrapper = shallowMount(ArticleCard, {
      props: { item: makeArticle({ unread: true }) },
    });
    expect(wrapper.find("article").classes()).toContain("unread");
  });

  it("does not apply unread class when item is read", () => {
    const wrapper = shallowMount(ArticleCard, {
      props: { item: makeArticle({ unread: false }) },
    });
    expect(wrapper.find("article").classes()).not.toContain("unread");
  });

  it("renders tags as chips", () => {
    const wrapper = shallowMount(ArticleCard, {
      props: { item: makeArticle({ tags: ["vue", "testing"] }) },
    });
    const chips = wrapper.findAll(".chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].text()).toBe("#vue");
  });

  it("emits open on click", async () => {
    const wrapper = shallowMount(ArticleCard, { props: { item } });
    await wrapper.find("article").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("re-emits star from the card actions", async () => {
    const wrapper = shallowMount(ArticleCard, { props: { item } });
    wrapper.findComponent({ name: "CardActions" }).vm.$emit("star");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("star")).toHaveLength(1);
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(ArticleCard, { props: { item } });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
