import { describe, it, expect } from "vitest";
import { shallowMount } from "@vue/test-utils";
import FeedItem from "~/components/FeedItem.vue";
import { makeArticle, makeVideo, makeTweet } from "../fixtures";

describe("FeedItem", () => {
  it("renders an article item without errors", () => {
    const wrapper = shallowMount(FeedItem, {
      props: { item: makeArticle() },
    });
    expect(wrapper.html()).toBeTruthy();
  });

  it("renders a video item without errors", () => {
    const wrapper = shallowMount(FeedItem, {
      props: { item: makeVideo() },
    });
    expect(wrapper.html()).toBeTruthy();
  });

  it("passes save emit upward", async () => {
    const wrapper = shallowMount(FeedItem, {
      props: { item: makeArticle() },
    });
    wrapper.findComponent({ name: "ArticleCard" }).vm.$emit("save");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("passes star emit upward", async () => {
    const wrapper = shallowMount(FeedItem, {
      props: { item: makeArticle() },
    });
    wrapper.findComponent({ name: "ArticleCard" }).vm.$emit("star");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("star")).toBeTruthy();
  });

  it("matches snapshot for article", () => {
    const wrapper = shallowMount(FeedItem, {
      props: { item: makeArticle() },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot for tweet", () => {
    const wrapper = shallowMount(FeedItem, {
      props: { item: makeTweet() },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
