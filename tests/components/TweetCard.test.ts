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

  it("does not render mock-only fields (text/meta likes & reposts)", () => {
    // The synced API returns no engagement counts; item.meta / item.text are
    // gone, so no fabricated like/repost figures should appear.
    const wrapper = shallowMount(TweetCard, {
      props: { item: makeTweet({ content: "Body." }) },
    });
    expect(wrapper.html()).not.toContain("undefined");
    expect(wrapper.find(".tw-actions").findAll("span")).toHaveLength(0);
  });
});
