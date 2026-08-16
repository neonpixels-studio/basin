export type BillingInterval = "month" | "year";

export interface AccountPlan {
  plan: "free" | "pro";
  status: string;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export const FREE_ACCOUNT_PLAN: AccountPlan = {
  plan: "free",
  status: "none",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export function useBilling() {
  const { buildAuthHeaders } = useAuthHeaders();
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadPlan(): Promise<AccountPlan> {
    loading.value = true;
    error.value = null;
    try {
      const headers = await buildAuthHeaders();
      return await $fetch<AccountPlan>("/api/billing/plan", { headers });
    } catch {
      error.value = "Failed to load plan";
      return { ...FREE_ACCOUNT_PLAN };
    } finally {
      loading.value = false;
    }
  }

  // Starts a Stripe Checkout session for the given interval and redirects the
  // browser to it. Errors are surfaced via `error` rather than thrown so
  // callers (a click handler) don't need a try/catch.
  async function startCheckout(interval: BillingInterval): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const headers = await buildAuthHeaders();
      const { url } = await $fetch<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        headers,
        body: { interval },
      });
      window.location.href = url;
    } catch {
      error.value = "Failed to start checkout. Please try again.";
    } finally {
      loading.value = false;
    }
  }

  // Opens the Stripe Billing Portal so a subscriber can cancel, downgrade, or
  // update their payment method, then redirects the browser to it. Mirrors
  // startCheckout: errors surface via `error` rather than being thrown so the
  // click handler needs no try/catch.
  async function openPortal(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const headers = await buildAuthHeaders();
      const { url } = await $fetch<{ url: string }>("/api/billing/portal", {
        method: "POST",
        headers,
      });
      window.location.href = url;
    } catch {
      error.value = "Failed to open billing portal. Please try again.";
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, loadPlan, startCheckout, openPortal };
}
