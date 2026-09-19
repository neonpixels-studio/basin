import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import ErrorPage from "~/error.vue";

// A 4xx error: statusMessage is purpose-written H3 copy ("Not Found") and is
// safe to show verbatim.
const clientError = { statusCode: 404, statusMessage: "Not Found" };
// A 5xx error: even a benign-looking statusMessage must never reach the user
// — 5xx statusMessage can carry raw thrown err.message text, upstream API
// detail, or DB driver output.
const serverError = { statusCode: 503, statusMessage: "Service Unavailable" };

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
    const wrapper = shallowMount(ErrorPage, { props: { error: clientError } });
    expect(wrapper.find("h1").text()).toBe("404");
  });

  it("renders the statusMessage from the error prop on a 4xx", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: clientError } });
    expect(wrapper.text()).toContain("Not Found");
  });

  it("shows the generic message on a 5xx, never the raw statusMessage", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: serverError } });
    expect(wrapper.find("h1").text()).toBe("503");
    expect(wrapper.text()).not.toContain("Service Unavailable");
    expect(wrapper.text()).toContain("Something threw us off the trail.");
  });

  // Pins the top edge of the 4xx range exactly at 499/500 so a future
  // <=/< typo on CLIENT_ERROR_RANGE_END (which every other test here would
  // miss — 503 and 404 both sit well clear of the boundary, and the {}
  // fallback test carries no statusMessage either way) fails immediately: a
  // 500 must never be treated as a 4xx.
  it("treats exactly 500 as a server error, never the raw statusMessage", () => {
    const boundaryError = {
      statusCode: 500,
      statusMessage: "connection refused 10.0.0.4:5432",
    };
    const wrapper = shallowMount(ErrorPage, {
      props: { error: boundaryError },
    });
    expect(wrapper.text()).not.toContain("connection refused");
    expect(wrapper.text()).toContain("Something threw us off the trail.");
  });

  // Pins the bottom and top edges of the 4xx range so a future >/>= typo on
  // CLIENT_ERROR_RANGE_START, or <=/< typo on CLIENT_ERROR_RANGE_END, fails
  // immediately — the only other 4xx fixture (404) sits in the middle of
  // the range and can't catch either.
  it("shows the statusMessage at the bottom edge of the 4xx range (400)", () => {
    const wrapper = shallowMount(ErrorPage, {
      props: { error: { statusCode: 400, statusMessage: "Bad Request" } },
    });
    expect(wrapper.text()).toContain("Bad Request");
  });

  it("shows the statusMessage at the top edge of the 4xx range (499)", () => {
    const wrapper = shallowMount(ErrorPage, {
      props: {
        error: { statusCode: 499, statusMessage: "Client Closed Request" },
      },
    });
    expect(wrapper.text()).toContain("Client Closed Request");
  });

  // Guards the range check itself: an unexpected 3xx must fall back to the
  // generic message rather than being treated as "safe because it's not a
  // 5xx" — this app's routes never throw a 3xx with a user-facing
  // statusMessage, so there's nothing to trust here either.
  it("shows the generic message on an unexpected 3xx, never the raw statusMessage", () => {
    const redirectError = {
      statusCode: 302,
      statusMessage: "internal redirect target: /api/internal/debug",
    };
    const wrapper = shallowMount(ErrorPage, {
      props: { error: redirectError },
    });
    expect(wrapper.text()).not.toContain("internal redirect target");
    expect(wrapper.text()).toContain("Something threw us off the trail.");
  });

  it("falls back to defaults when the error prop is sparse", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: {} } });
    expect(wrapper.find("h1").text()).toBe("500");
    expect(wrapper.text()).toContain("Something threw us off the trail.");
  });

  // Covers the `|| DEFAULT_MESSAGE` fallback specifically inside the 4xx
  // branch — the sparse-{} test above only exercises the non-4xx branch
  // (it defaults to statusCode 500), so a regression dropping this fallback
  // for a 4xx with no statusMessage would otherwise go unnoticed.
  it("falls back to the generic message on a 4xx with no statusMessage", () => {
    const wrapper = shallowMount(ErrorPage, {
      props: { error: { statusCode: 404 } },
    });
    expect(wrapper.text()).toContain("Something threw us off the trail.");
    const [headArg] = useHead.mock.calls[0];
    expect(headArg.title.value).toBe("Something threw us off the trail.");
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

  it("sets the document title to the statusMessage on a 4xx", () => {
    shallowMount(ErrorPage, { props: { error: clientError } });
    expect(useHead).toHaveBeenCalledTimes(1);
    const [headArg] = useHead.mock.calls[0];
    expect(headArg.title.value).toBe("Not Found");
  });

  it("sets the document title to the generic message on a 5xx", () => {
    shallowMount(ErrorPage, { props: { error: serverError } });
    const [headArg] = useHead.mock.calls[0];
    expect(headArg.title.value).toBe("Something threw us off the trail.");
  });

  it("re-renders the current route via clearError on Try again", async () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: clientError } });
    await wrapper.find("button.btn-primary").trigger("click");
    expect(clearError).toHaveBeenCalledWith();
  });

  it("clears the error and redirects home on Back to your feed", async () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: clientError } });
    const backButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Back to your feed"));
    expect(backButton).toBeDefined();
    await backButton.trigger("click");
    expect(clearError).toHaveBeenCalledWith({
      redirect: "/dashboard",
    });
  });

  it("matches snapshot for a 4xx client error", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: clientError } });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("matches snapshot for a 5xx server error", () => {
    const wrapper = shallowMount(ErrorPage, { props: { error: serverError } });
    expect(wrapper.html()).toMatchSnapshot();
  });
});
