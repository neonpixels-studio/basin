import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetOrCreateStripeCustomerId,
  mockCreateCheckoutSession,
  mockGetConfiguredSiteUrl,
} = vi.hoisted(() => ({
  mockGetOrCreateStripeCustomerId: vi.fn(),
  mockCreateCheckoutSession: vi.fn(),
  mockGetConfiguredSiteUrl: vi.fn(),
}));
vi.mock("../../../../server/utils/subscriptions", () => ({
  getOrCreateStripeCustomerId: mockGetOrCreateStripeCustomerId,
}));
vi.mock("../../../../server/utils/stripe", () => ({
  createCheckoutSession: mockCreateCheckoutSession,
}));
vi.mock("../../../../server/utils/siteUrl", () => ({
  getConfiguredSiteUrl: mockGetConfiguredSiteUrl,
}));

// The shared readBody stub (tests/setup.ts) coerces a missing body to `{}`,
// which can't exercise the real Nitro behavior of resolving to `undefined`
// for a genuinely empty request body — override it per-test where needed.
const mockReadBody = vi.fn((event: { body?: unknown }) => event.body ?? {});
vi.stubGlobal("readBody", mockReadBody);

import handler from "../../../../server/api/billing/checkout.post";

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConfiguredSiteUrl.mockReturnValue("https://example.com");
    mockReadBody.mockImplementation((event: { body?: unknown }) =>
      Promise.resolve(event.body ?? {}),
    );
    mockGetOrCreateStripeCustomerId.mockResolvedValue("cus_123");
    mockCreateCheckoutSession.mockResolvedValue({
      url: "https://checkout.stripe.com/session_123",
    });
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null }, body: { interval: "month" } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 for a missing interval", async () => {
    const event = { context: { user: { id: 1 } }, body: {} };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 (not a 500) when the request body is empty", async () => {
    // A genuinely empty POST body resolves readBody to undefined in real
    // Nitro, unlike the shared test stub which coerces a missing `event.body`
    // to `{}` — reproduce that explicitly rather than relying on the stub.
    mockReadBody.mockResolvedValue(undefined);
    const event = { context: { user: { id: 1 } }, body: {} };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 for an invalid interval", async () => {
    const event = {
      context: { user: { id: 1 } },
      body: { interval: "week" },
    };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns the checkout session URL", async () => {
    const event = {
      context: { user: { id: 1 } },
      body: { interval: "year" },
    };
    const result = await handler(event);
    expect(result).toEqual({ url: "https://checkout.stripe.com/session_123" });
  });

  it("passes the authenticated user's id and requested interval through", async () => {
    const event = {
      context: { user: { id: 42 } },
      body: { interval: "month" },
    };
    await handler(event);
    expect(mockGetOrCreateStripeCustomerId).toHaveBeenCalledWith(42, null);
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_123",
        interval: "month",
        userId: 42,
      }),
    );
  });

  it("builds success/cancel URLs from the configured site URL, not the request host", async () => {
    mockGetConfiguredSiteUrl.mockReturnValue("https://basin.example");
    const event = {
      context: { user: { id: 1 } },
      body: { interval: "year" },
    };
    await handler(event);
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: "https://basin.example/settings/account?checkout=success",
        cancelUrl: "https://basin.example/pricing?checkout=cancelled",
      }),
    );
  });

  it("does not create a Stripe customer when the site URL is unconfigured", async () => {
    // The redirect base is resolved before the customer is created so a
    // misconfigured site URL can't leave an orphaned Stripe customer behind.
    mockGetConfiguredSiteUrl.mockImplementation(() => {
      throw Object.assign(new Error("Site URL is not configured"), {
        statusCode: 500,
      });
    });
    const event = {
      context: { user: { id: 1 } },
      body: { interval: "month" },
    };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 500 });
    expect(mockGetOrCreateStripeCustomerId).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("never forwards a client-supplied email to the customer lookup", async () => {
    const event = {
      context: { user: { id: 1 } },
      body: { interval: "year", email: "attacker@evil.com" },
    };
    await handler(event);
    expect(mockGetOrCreateStripeCustomerId).toHaveBeenCalledWith(1, null);
  });

  it("throws 502 when Stripe does not return a session URL", async () => {
    mockCreateCheckoutSession.mockResolvedValue({ url: null });
    const event = {
      context: { user: { id: 1 } },
      body: { interval: "year" },
    };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 502 });
  });
});
