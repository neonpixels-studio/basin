import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import { ref } from "vue";
import PricingPage from "~/pages/pricing.vue";

const mockNavigateTo = vi.fn();
vi.stubGlobal("navigateTo", mockNavigateTo);

function stubAuth(isSignedIn: boolean, isLoaded = true) {
  vi.stubGlobal("useAuth", () => ({
    isSignedIn: ref(isSignedIn),
    isLoaded: ref(isLoaded),
  }));
}

function stubBilling(startCheckout = vi.fn(), error: string | null = null) {
  vi.stubGlobal("useBilling", () => ({
    loading: ref(false),
    error: ref(error),
    loadPlan: vi.fn(),
    startCheckout,
  }));
  return startCheckout;
}

function stubRoute(query: Record<string, string> = {}) {
  vi.stubGlobal("useRoute", () => ({ path: "/pricing", params: {}, query }));
}

describe("pricing page (/pricing)", () => {
  beforeEach(() => {
    mockNavigateTo.mockClear();
    stubAuth(false);
    stubBilling();
    stubRoute();
    vi.mocked(globalThis.useSeoMeta).mockClear();
    vi.mocked(globalThis.useHead).mockClear();
  });

  it("emits og/twitter meta anchored to the configured site URL", () => {
    shallowMount(PricingPage);
    expect(globalThis.useSeoMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Pricing — Reader",
        ogTitle: "Pricing — Reader",
        ogType: "website",
        ogUrl: "https://basin.example/pricing",
        ogSiteName: "Reader",
        twitterCard: "summary",
        twitterTitle: "Pricing — Reader",
      }),
    );
  });

  it("emits a canonical link anchored to the configured site URL", () => {
    shallowMount(PricingPage);
    expect(globalThis.useHead).toHaveBeenCalledWith({
      link: [{ rel: "canonical", href: "https://basin.example/pricing" }],
    });
  });

  it("renders the price header", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.find(".price-top").exists()).toBe(true);
  });

  it("renders the billing toggle", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.find(".bill").exists()).toBe(true);
    expect(wrapper.findAll(".bill .seg button")).toHaveLength(2);
  });

  it("defaults to yearly billing", () => {
    const wrapper = shallowMount(PricingPage);
    const buttons = wrapper.findAll(".bill .seg button");
    expect(buttons[1].classes()).toContain("active");
  });

  it("shows yearly price by default", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.find(".plan.featured .plan-amt").text()).toBe("$6");
  });

  it("switches to monthly price when toggle is clicked", async () => {
    const wrapper = shallowMount(PricingPage);
    const monthBtn = wrapper.findAll(".bill .seg button")[0];
    await monthBtn.trigger("click");
    expect(wrapper.find(".plan.featured .plan-amt").text()).toBe("$8");
  });

  it("renders two plan cards", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.findAll(".plan")).toHaveLength(2);
  });

  it("renders the featured (Pro) plan", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.find(".plan.featured").exists()).toBe(true);
  });

  it("renders the FAQ section", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.find(".faq").exists()).toBe(true);
  });

  it("renders four FAQ items", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.findAll(".faq-item")).toHaveLength(4);
  });

  it("first FAQ item is open by default", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.findAll(".faq-item")[0].classes()).toContain("open");
  });

  it("toggles FAQ item open state on click", async () => {
    const wrapper = shallowMount(PricingPage);
    const firstBtn = wrapper.findAll(".faq-q")[0];
    await firstBtn.trigger("click");
    expect(wrapper.findAll(".faq-item")[0].classes()).not.toContain("open");
  });

  it("renders the CTA band", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.find(".cta-band").exists()).toBe(true);
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(PricingPage);
    expect(wrapper.html()).toMatchSnapshot();
  });

  describe("Pro checkout CTA", () => {
    it("routes signed-out visitors to /login preserving the checkout intent", async () => {
      const wrapper = shallowMount(PricingPage);
      await wrapper.find(".plan.featured button.btn-primary").trigger("click");
      expect(mockNavigateTo).toHaveBeenCalledWith(
        "/login?redirect_url=%2Fpricing%3Fcheckout%3Dyear",
      );
    });

    it("starts checkout directly for a signed-in visitor", async () => {
      stubAuth(true);
      const startCheckout = stubBilling();
      const wrapper = shallowMount(PricingPage);
      await wrapper.find(".plan.featured button.btn-primary").trigger("click");
      expect(startCheckout).toHaveBeenCalledWith("year");
      expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it("uses the currently selected billing interval", async () => {
      stubAuth(true);
      const startCheckout = stubBilling();
      const wrapper = shallowMount(PricingPage);
      await wrapper.findAll(".bill .seg button")[0].trigger("click");
      await wrapper.find(".plan.featured button.btn-primary").trigger("click");
      expect(startCheckout).toHaveBeenCalledWith("month");
    });

    it("wires the bottom CTA band button the same way", async () => {
      stubAuth(true);
      const startCheckout = stubBilling();
      const wrapper = shallowMount(PricingPage);
      await wrapper.find(".cta-band button.btn-primary").trigger("click");
      expect(startCheckout).toHaveBeenCalledWith("year");
    });

    it("auto-starts checkout when returning from login with a preserved intent", () => {
      stubAuth(true);
      const startCheckout = stubBilling();
      stubRoute({ checkout: "month" });
      shallowMount(PricingPage);
      expect(startCheckout).toHaveBeenCalledWith("month");
    });

    it("does not auto-start checkout without a checkout query param", () => {
      stubAuth(true);
      const startCheckout = stubBilling();
      stubRoute({});
      shallowMount(PricingPage);
      expect(startCheckout).not.toHaveBeenCalled();
    });

    it("ignores an invalid checkout query value", () => {
      stubAuth(true);
      const startCheckout = stubBilling();
      stubRoute({ checkout: "lifetime" });
      shallowMount(PricingPage);
      expect(startCheckout).not.toHaveBeenCalled();
    });

    it("does not auto-start checkout while signed out", () => {
      stubAuth(false);
      const startCheckout = stubBilling();
      stubRoute({ checkout: "month" });
      shallowMount(PricingPage);
      expect(startCheckout).not.toHaveBeenCalled();
    });

    it("shows the checkout error message when present", () => {
      stubBilling(vi.fn(), "Failed to start checkout. Please try again.");
      const wrapper = shallowMount(PricingPage);
      expect(wrapper.find(".plan-error").text()).toBe(
        "Failed to start checkout. Please try again.",
      );
    });

    it("disables the CTAs until Clerk finishes loading auth state", () => {
      // isSignedIn reads falsy until isLoaded flips true, even for an
      // authenticated user — the CTA must stay disabled during that window
      // instead of racing ahead and misrouting to /login.
      stubAuth(false, false);
      const wrapper = shallowMount(PricingPage);
      expect(
        wrapper
          .find(".plan.featured button.btn-primary")
          .attributes("disabled"),
      ).toBeDefined();
      expect(
        wrapper.find(".cta-band button.btn-primary").attributes("disabled"),
      ).toBeDefined();
    });

    it("does not route to /login when clicked before Clerk has loaded", async () => {
      stubAuth(false, false);
      const startCheckout = stubBilling();
      const wrapper = shallowMount(PricingPage);
      await wrapper.find(".plan.featured button.btn-primary").trigger("click");
      expect(mockNavigateTo).not.toHaveBeenCalled();
      expect(startCheckout).not.toHaveBeenCalled();
    });

    it("enables the CTAs once Clerk has loaded", () => {
      stubAuth(true, true);
      const wrapper = shallowMount(PricingPage);
      expect(
        wrapper
          .find(".plan.featured button.btn-primary")
          .attributes("disabled"),
      ).toBeUndefined();
    });
  });
});
