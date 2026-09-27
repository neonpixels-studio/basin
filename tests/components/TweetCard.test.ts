import { describe, it, expect } from "vitest";
import { shallowMount } from "@vue/test-utils";
import TweetCard from "~/components/TweetCard.vue";
import { makeTweet } from "../fixtures";

describe("TweetCard", () => {
  it("renders correctly", () => {
    const wrapper = shallowMount(TweetCard, { props: { item: makeTweet() } });
    expect(wrapper.html()).toBeTruthy();
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(TweetCard, { props: { item: makeTweet() } });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the post body from the synced content field", () => {
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet({ content: "Hello from a real feed." }) },
    });
    expect(wrapper.find(".tw-text").text()).toBe("Hello from a real feed.");
  });

  it("renders no body when the synced item has no content", () => {
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet({ content: null }) },
    });
    expect(wrapper.find(".tw-text").exists()).toBe(false);
  });

  // Regression guard for basin#310: the header must show the post author, and
  // the handle line must show the real handle, not the feed's own title.
  it("renders the post author's name and handle instead of the feed's title", () => {
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet({ author: "Real Author", handle: "@real" }) },
    });
    expect(wrapper.find(".tw-id b").text()).toBe("Real Author");
    expect(wrapper.find(".tw-handle").text()).toContain("@real");
    expect(wrapper.find(".tw-id b").text()).not.toBe(
      makeTweet().source as string,
    );
  });

  it("falls back to the feed title when the item has no author", () => {
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet({ author: null }) },
    });
    expect(wrapper.find(".tw-id b").text()).toBe(makeTweet().source as string);
  });

  it("renders no engagement counts (the mock-only likes/reposts are gone)", () => {
    // The synced API returns no engagement data; the like/repost spans that
    // read item.meta must be absent — only the save/star buttons remain.
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet({ content: "Body." }) },
    });
    expect(wrapper.find(".tw-actions").findAll("span")).toHaveLength(0);
    expect(wrapper.find(".tw-actions").findAll("button")).toHaveLength(2);
  });

  it("emits save then star from the two action buttons", async () => {
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet() },
    });
    const buttons = wrapper.find(".tw-actions").findAll("button");
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(wrapper.emitted("star")).toHaveLength(1);
  });
});
