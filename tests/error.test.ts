import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import ErrorPage from "~/error.vue";

const sampleError = { statusCode: 500, statusMessage: "Internal Server Error" };

describe("error.vue (fatal error page)", () => {
  let clearError;
  let useHead;

  beforeEach(() => {
    clearError = vi.fn();
    useHead = vi.fn();
    vi.stubGlobal("clearError", clearError);
    vi.stubGlobal("useHead", useHead);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the error status code", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: sampleError } });
    expect(wrapper.find("h1").text()).toBe("500");
  });

  it("renders the status message from the error prop", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: sampleError } });
    expect(wrapper.text()).toContain("Internal Server Error");
  });

  it("falls back to defaults when the error prop is sparse", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: {} } });
    expect(wrapper.find("h1").text()).toBe("500");
    expect(wrapper.text()).toContain("Something threw us off the trail.");
  });

  it("never surfaces raw error.message to the user", () => {
    const leaky = {
      statusCode: 500,
      message: "Cannot read properties of undefined",
    };
    const wrapper = shallowMount(ErrorPage, { props: { error: leaky } });
    expect(wrapper.text()).not.toContain("Cannot read properties");
    expect(wrapper.text()).toContain("Something threw us off the trail.");
  });

  it("sets the document title to the error message", () => {
    shallowMount(ErrorPage, { props: { error: sampleError } });
    expect(useHead).toHaveBeenCalledTimes(1);
    const [headArg] = useHead.mock.calls[0];
    expect(headArg.title.value).toBe("Internal Server Error");
  });

  it("re-renders the current route via clearError on Try again", async () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: sampleError } });
    await wrapper.find("button.btn-primary").trigger("click");
    expect(clearError).toHaveBeenCalledWith();
  });

  it("clears the error and redirects home on Back to your feed", async () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: sampleError } });
    const backButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Back to your feed"));
    expect(backButton).toBeDefined();
    await backButton.trigger("click");
    expect(clearError).toHaveBeenCalledWith({
      redirect: "/dashboard",
    });
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: sampleError } });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
