import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import SettingsAccount from "~/components/SettingsAccount.vue";
import { FREE_ACCOUNT_PLAN } from "~/composables/useBilling";

function stubFeed(itemCount = 12) {
  vi.stubGlobal("useFeedStore", () => ({
    state: { items: Array.from({ length: itemCount }) },
  }));
}

function stubBilling(plan = { ...FREE_ACCOUNT_PLAN }, openPortal = vi.fn()) {
  vi.stubGlobal("useBilling", () => ({
    loading: ref(false),
    error: ref(null),
    loadPlan: vi.fn().mockResolvedValue(plan),
    startCheckout: vi.fn(),
    openPortal,
  }));
}

const PRO_PLAN = {
  plan: "pro",
  status: "active",
  trialEnd: null,
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};

describe("SettingsAccount", () => {
  beforeEach(() => {
    stubFeed();
    stubBilling();
    vi.stubGlobal("useAccountExport", () => ({
      exporting: ref(false),
      error: ref(null),
      exportData: vi.fn(),
    }));
  });

  it("displays the user's full name", () => {
    const wrapper = shallowMount(SettingsAccount);
    expect(wrapper.find(".conn-name").text()).toBe("Demo User");
  });

  it("displays the user's email", () => {
    const wrapper = shallowMount(SettingsAccount);
    expect(wrapper.find(".conn-desc").text()).toBe("demo@example.com");
  });

  it("shows item count in the plan line", () => {
    const wrapper = shallowMount(SettingsAccount);
    expect(wrapper.find(".conn-since").text()).toContain("12 items today");
  });

  it("calls signOut when sign out button is clicked", async () => {
    const signOut = vi.fn();
    vi.stubGlobal("useClerk", () => ref({ signOut }));
    const wrapper = shallowMount(SettingsAccount);
    await wrapper.find("button.btn").trigger("click");
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/login" });
  });

  it("renders nothing for the avatar when user has no image (AvatarButton handles it)", () => {
    const wrapper = shallowMount(SettingsAccount);
    expect(wrapper.find("avatar-button-stub").exists()).toBe(true);
  });

  describe("billing", () => {
    it("shows the Free plan by default before loadPlan resolves", () => {
      const wrapper = shallowMount(SettingsAccount);
      expect(wrapper.find(".conn-since").text()).toContain("Free plan");
    });

    it("shows an Upgrade to Pro link on the free plan", () => {
      const wrapper = shallowMount(SettingsAccount);
      const upgradeLink = wrapper.find('a[href="/pricing"]');
      expect(upgradeLink.exists()).toBe(true);
      expect(upgradeLink.text()).toContain("Upgrade to Pro");
    });

    it("shows the Pro plan once loadPlan resolves", async () => {
      stubBilling({
        plan: "pro",
        status: "active",
        trialEnd: null,
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      expect(wrapper.find(".conn-since").text()).toContain("Pro plan");
    });

    it("hides the Upgrade to Pro link on the pro plan", async () => {
      stubBilling({
        plan: "pro",
        status: "active",
        trialEnd: null,
        currentPeriodEnd: "2026-08-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      expect(wrapper.find('a[href="/pricing"]').exists()).toBe(false);
    });

    it("shows the trial end date while trialing", async () => {
      stubBilling({
        plan: "pro",
        status: "trialing",
        trialEnd: "2026-08-15T00:00:00.000Z",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      expect(wrapper.find(".billing-desc").text()).toContain("trial ends");
    });

    function findManageButton(wrapper) {
      return wrapper
        .findAll("button.btn")
        .find((button) => button.text().includes("Manage subscription"));
    }

    it("hides the Manage subscription button on the free plan", async () => {
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      expect(findManageButton(wrapper)).toBeUndefined();
    });

    it("shows a Manage subscription button on the pro plan", async () => {
      stubBilling({ ...PRO_PLAN });
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      expect(findManageButton(wrapper)).toBeTruthy();
    });

    it("opens the billing portal when Manage subscription is clicked", async () => {
      const openPortal = vi.fn();
      stubBilling({ ...PRO_PLAN }, openPortal);
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      await findManageButton(wrapper)?.trigger("click");
      expect(openPortal).toHaveBeenCalledOnce();
    });

    it("shows a billing error message when the portal fails to open", async () => {
      vi.stubGlobal("useBilling", () => ({
        loading: ref(false),
        error: ref("Failed to open billing portal. Please try again."),
        loadPlan: vi.fn().mockResolvedValue({ ...PRO_PLAN }),
        startCheckout: vi.fn(),
        openPortal: vi.fn(),
      }));
      const wrapper = shallowMount(SettingsAccount);
      await flushPromises();
      expect(wrapper.find(".billing-error").text()).toContain(
        "Failed to open billing portal",
      );
    });
  });

  describe("data export", () => {
    it("calls exportData when the export button is clicked", async () => {
      const exportData = vi.fn();
      vi.stubGlobal("useAccountExport", () => ({
        exporting: ref(false),
        error: ref(null),
        exportData,
      }));
      const wrapper = shallowMount(SettingsAccount);
      const exportButton = wrapper
        .findAll("button.btn")
        .find((button) => button.text().includes("Export my data"));
      await exportButton?.trigger("click");
      expect(exportData).toHaveBeenCalledOnce();
    });

    it("shows an error message when the export fails", () => {
      vi.stubGlobal("useAccountExport", () => ({
        exporting: ref(false),
        error: ref("Failed to export your data — try again"),
        exportData: vi.fn(),
      }));
      const wrapper = shallowMount(SettingsAccount);
      expect(wrapper.find(".export-error").text()).toContain(
        "Failed to export your data",
      );
    });
  });

  it("matches snapshot", async () => {
    const wrapper = shallowMount(SettingsAccount);
    await flushPromises();
    expect(wrapper.html()).toMatchSnapshot();
  });
});
