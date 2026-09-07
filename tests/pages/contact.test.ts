import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import ContactPage from "~/pages/contact.vue";

function mountWithValidForm(valid = true) {
  const wrapper = shallowMount(ContactPage);
  const form = wrapper.find("form.contact-form").element as HTMLFormElement;
  // happy-dom reports an empty required form as invalid; control validity so we
  // exercise the submit branch we care about.
  form.checkValidity = () => valid;
  form.reportValidity = () => valid;
  return wrapper;
}

describe("contact page (/contact)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true } as Response)),
    );
    vi.stubGlobal("useRoute", () => ({
      path: "/contact",
      params: {},
      query: {},
    }));
    vi.mocked(globalThis.useSeoMeta).mockClear();
    vi.mocked(globalThis.useHead).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits og/twitter meta anchored to the configured site URL", () => {
    mountWithValidForm();
    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reader — contact",
        ogTitle: "Reader — contact",
        ogType: "website",
        ogUrl: "https://basin.example/contact",
        ogSiteName: "Reader",
        twitterCard: "summary",
        twitterTitle: "Reader — contact",
      }),
    );
  });

  it("emits a canonical link anchored to the configured site URL", () => {
    mountWithValidForm();
    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://basin.example/contact" }],
    });
  });

  it("renders the contact form with name, email, and message fields", () => {
    const wrapper = shallowMount(ContactPage);
    expect(wrapper.find("form.contact-form").exists()).toBe(true);
    expect(wrapper.find("input[name='name']").exists()).toBe(true);
    expect(wrapper.find("input[name='email']").exists()).toBe(true);
    expect(wrapper.find("textarea[name='message']").exists()).toBe(true);
  });

  it("is set up for Netlify form detection", () => {
    const wrapper = shallowMount(ContactPage);
    const form = wrapper.find("form.contact-form");
    expect(form.attributes("data-netlify")).toBe("true");
    expect(form.attributes("name")).toBe("contact");
    expect(wrapper.find("input[name='form-name']").attributes("value")).toBe(
      "contact",
    );
    expect(wrapper.find("input[name='bot-field']").exists()).toBe(true);
  });

  it("does not show the success state initially", () => {
    const wrapper = shallowMount(ContactPage);
    expect(wrapper.find(".contact-card").classes()).not.toContain("sent");
  });

  it("POSTs the encoded form to Netlify and shows success", async () => {
    const wrapper = mountWithValidForm();

    await wrapper.find("form.contact-form").trigger("submit");
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(options.body).toContain("form-name=contact");
    expect(wrapper.find(".contact-card").classes()).toContain("sent");
  });

  it("does not submit when validation fails", async () => {
    const wrapper = mountWithValidForm(false);

    await wrapper.find("form.contact-form").trigger("submit");
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.find(".contact-card").classes()).not.toContain("sent");
  });

  it("shows an error and stays on the form when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)),
    );
    const wrapper = mountWithValidForm();

    await wrapper.find("form.contact-form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".contact-card").classes()).not.toContain("sent");
    expect(wrapper.find(".form-error").exists()).toBe(true);
  });

  it("renders social links pointing at real profile URLs", () => {
    const wrapper = shallowMount(ContactPage);
    const links = wrapper.findAll(".socials .social");
    expect(links).toHaveLength(3);
    links.forEach((link) => {
      const href = link.attributes("href");
      expect(href).toMatch(/^https:\/\//);
      expect(href).not.toBe("#");
    });
  });
});
