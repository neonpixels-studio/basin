import { describe, it, expect, vi, beforeEach } from "vitest";
import { useBilling, FREE_ACCOUNT_PLAN } from "~/composables/useBilling";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const mockGetToken = vi.fn().mockResolvedValue("token-123");
vi.stubGlobal("useAuth", () => ({ getToken: { value: mockGetToken } }));

const mockLocation = { href: "" };
vi.stubGlobal("location", mockLocation);

describe("useBilling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetToken.mockResolvedValue("token-123");
    mockLocation.href = "";
  });

  describe("loadPlan()", () => {
    it("returns the plan from the API", async () => {
      const plan = {
        plan: "pro",
        status: "trialing",
        trialEnd: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
      mockFetch.mockResolvedValue(plan);
      const { loadPlan } = useBilling();
      expect(await loadPlan()).toEqual(plan);
    });

    it("sends the Clerk bearer token", async () => {
      mockFetch.mockResolvedValue({ ...FREE_ACCOUNT_PLAN });
      const { loadPlan } = useBilling();
      await loadPlan();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/billing/plan",
        expect.objectContaining({
          headers: { Authorization: "Bearer token-123" },
        }),
      );
    });

    it("falls back to the free plan and sets error on failure", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const { loadPlan, error } = useBilling();
      const plan = await loadPlan();
      expect(plan).toEqual(FREE_ACCOUNT_PLAN);
      expect(error.value).toBeTruthy();
    });
  });

  describe("startCheckout()", () => {
    it("posts the interval (no client-supplied email)", async () => {
      mockFetch.mockResolvedValue({ url: "https://checkout.stripe.com/x" });
      const { startCheckout } = useBilling();
      await startCheckout("year");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({
          method: "POST",
          body: { interval: "year" },
        }),
      );
    });

    it("redirects the browser to the returned checkout URL", async () => {
      mockFetch.mockResolvedValue({ url: "https://checkout.stripe.com/x" });
      const { startCheckout } = useBilling();
      await startCheckout("month");
      expect(mockLocation.href).toBe("https://checkout.stripe.com/x");
    });

    it("sets error and does not navigate when the request fails", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const { startCheckout, error } = useBilling();
      await startCheckout("month");
      expect(error.value).toBeTruthy();
      expect(mockLocation.href).toBe("");
    });

    it("clears a previous error on a new attempt", async () => {
      const { startCheckout, error } = useBilling();
      mockFetch.mockRejectedValueOnce(new Error("oops"));
      await startCheckout("month");
      expect(error.value).toBeTruthy();
      mockFetch.mockResolvedValueOnce({ url: "https://checkout.stripe.com/x" });
      await startCheckout("month");
      expect(error.value).toBeNull();
    });
  });

  describe("openPortal()", () => {
    it("posts to the billing portal endpoint", async () => {
      mockFetch.mockResolvedValue({ url: "https://billing.stripe.com/x" });
      const { openPortal } = useBilling();
      await openPortal();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/billing/portal",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer token-123" },
        }),
      );
    });

    it("redirects the browser to the returned portal URL", async () => {
      mockFetch.mockResolvedValue({ url: "https://billing.stripe.com/x" });
      const { openPortal } = useBilling();
      await openPortal();
      expect(mockLocation.href).toBe("https://billing.stripe.com/x");
    });

    it("sets error and does not navigate when the request fails", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      const { openPortal, error } = useBilling();
      await openPortal();
      expect(error.value).toBeTruthy();
      expect(mockLocation.href).toBe("");
    });
  });
});
