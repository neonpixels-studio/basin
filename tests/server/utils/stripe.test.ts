import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSessionsCreate,
  mockCustomersCreate,
  mockCustomersDel,
  mockConstructEvent,
  MockStripe,
} = vi.hoisted(() => {
  const mockSessionsCreate = vi.fn();
  const mockCustomersCreate = vi.fn();
  const mockCustomersDel = vi.fn();
  const mockConstructEvent = vi.fn();
  // A regular function (not an arrow function) so `new Stripe(...)` in the
  // source can construct it; returning an object overrides the `this` binding.
  const MockStripe = vi.fn().mockImplementation(function () {
    return {
      checkout: { sessions: { create: mockSessionsCreate } },
      customers: { create: mockCustomersCreate, del: mockCustomersDel },
      webhooks: { constructEvent: mockConstructEvent },
    };
  });
  return {
    mockSessionsCreate,
    mockCustomersCreate,
    mockCustomersDel,
    mockConstructEvent,
    MockStripe,
  };
});

vi.mock("stripe", () => ({ default: MockStripe }));

// Lets individual tests override the runtime config returned below.
const runtimeConfigValue: { value: Record<string, string> | null } = {
  value: null,
};

vi.stubGlobal(
  "useRuntimeConfig",
  () =>
    runtimeConfigValue.value ?? {
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      stripePriceProMonthly: "price_monthly",
      stripePriceProYearly: "price_yearly",
    },
);
vi.stubGlobal(
  "createError",
  (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), {
      statusCode: input.statusCode,
    }),
);

import {
  getStripeClient,
  priceIdForInterval,
  createCheckoutSession,
  createStripeCustomer,
  deleteStripeCustomer,
  verifyWebhookSignature,
} from "../../../server/utils/stripe";

describe("getStripeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigValue.value = null;
  });

  it("constructs a Stripe client with the configured secret key and a pinned API version", () => {
    getStripeClient();
    expect(MockStripe).toHaveBeenCalledWith(
      "sk_test_123",
      expect.objectContaining({ apiVersion: expect.any(String) }),
    );
  });

  it("throws a 500 when the secret key is not configured", () => {
    runtimeConfigValue.value = { stripeSecretKey: "" };
    expect(() => getStripeClient()).toThrow(/not configured/);
  });
});

describe("priceIdForInterval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigValue.value = null;
  });

  it("returns the monthly price ID for 'month'", () => {
    expect(priceIdForInterval("month")).toBe("price_monthly");
  });

  it("returns the yearly price ID for 'year'", () => {
    expect(priceIdForInterval("year")).toBe("price_yearly");
  });

  it("throws a 500 when the price ID is not configured", () => {
    runtimeConfigValue.value = {
      stripeSecretKey: "sk_test_123",
      stripePriceProMonthly: "",
      stripePriceProYearly: "",
    };
    expect(() => priceIdForInterval("month")).toThrow(/monthly Pro plan/);
  });
});

describe("createCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigValue.value = null;
    mockSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_123",
    });
  });

  it("creates a subscription-mode session with a 14-day trial", async () => {
    await createCheckoutSession({
      customerId: "cus_123",
      interval: "year",
      userId: 42,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_123",
        client_reference_id: "42",
        line_items: [{ price: "price_yearly", quantity: 1 }],
        // Card-free trial: no card collected up front; cancel if none is added.
        payment_method_collection: "if_required",
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
        subscription_data: expect.objectContaining({
          trial_period_days: 14,
          trial_settings: {
            end_behavior: { missing_payment_method: "cancel" },
          },
          metadata: { userId: "42" },
        }),
      }),
    );
  });

  it("returns the created session", async () => {
    const session = await createCheckoutSession({
      customerId: "cus_123",
      interval: "month",
      userId: 1,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    expect(session.url).toBe("https://checkout.stripe.com/session_123");
  });
});

describe("createStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigValue.value = null;
    mockCustomersCreate.mockResolvedValue({ id: "cus_new" });
  });

  it("creates a customer with the userId in metadata", async () => {
    await createStripeCustomer({ email: "person@example.com", userId: 7 });
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: "person@example.com",
      metadata: { userId: "7" },
    });
  });

  it("omits email when null", async () => {
    await createStripeCustomer({ email: null, userId: 7 });
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: undefined,
      metadata: { userId: "7" },
    });
  });
});

describe("deleteStripeCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigValue.value = null;
    mockCustomersDel.mockResolvedValue({ id: "cus_x", deleted: true });
  });

  it("deletes the given customer", async () => {
    await deleteStripeCustomer("cus_x");
    expect(mockCustomersDel).toHaveBeenCalledWith("cus_x");
  });
});

describe("verifyWebhookSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfigValue.value = null;
  });

  it("throws a 500 when the webhook secret is not configured", () => {
    runtimeConfigValue.value = {
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "",
    };
    expect(() => verifyWebhookSignature("{}", "sig")).toThrow(/not configured/);
  });

  it("delegates to stripe.webhooks.constructEvent with the raw body, signature, and secret", () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.updated",
    });
    const result = verifyWebhookSignature("{}", "t=1,v1=abc");
    expect(mockConstructEvent).toHaveBeenCalledWith(
      "{}",
      "t=1,v1=abc",
      "whsec_123",
    );
    expect(result).toEqual({ type: "customer.subscription.updated" });
  });

  it("propagates signature verification failures", () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    expect(() => verifyWebhookSignature("{}", "bad-sig")).toThrow(
      "Invalid signature",
    );
  });
});
