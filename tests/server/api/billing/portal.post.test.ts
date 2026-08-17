import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetStripeCustomerId, mockCreateBillingPortalSession } = vi.hoisted(
  () => ({
    mockGetStripeCustomerId: vi.fn(),
    mockCreateBillingPortalSession: vi.fn(),
  }),
);
vi.mock("../../../../server/utils/subscriptions", () => ({
  getStripeCustomerId: mockGetStripeCustomerId,
}));
vi.mock("../../../../server/utils/stripe", () => ({
  createBillingPortalSession: mockCreateBillingPortalSession,
}));

const mockGetRequestURL = vi.fn();
vi.stubGlobal("getRequestURL", mockGetRequestURL);

import handler from "../../../../server/api/billing/portal.post";

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetRequestURL.mockReturnValue(
      new URL("https://example.com/api/billing/portal"),
    );
    mockGetStripeCustomerId.mockResolvedValue("cus_123");
    mockCreateBillingPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/session_123",
    });
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled();
  });

  it("throws 404 when the user has no Stripe customer", async () => {
    mockGetStripeCustomerId.mockResolvedValue(null);
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled();
  });

  it("returns the billing portal session URL", async () => {
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result).toEqual({
      url: "https://billing.stripe.com/session_123",
    });
  });

  it("creates the portal session for the authenticated user's own customer", async () => {
    const event = { context: { user: { id: 42 } } };
    await handler(event);
    expect(mockGetStripeCustomerId).toHaveBeenCalledWith(42);
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_123" }),
    );
  });

  it("builds the return URL from the request origin", async () => {
    mockGetRequestURL.mockReturnValue(
      new URL("https://myapp.com/api/billing/portal"),
    );
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: "https://myapp.com/settings/account",
      }),
    );
  });

  it("throws 502 when Stripe does not return a session URL", async () => {
    mockCreateBillingPortalSession.mockResolvedValue({ url: null });
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 with a generic message when the Stripe call fails", async () => {
    mockCreateBillingPortalSession.mockRejectedValue(
      new Error("No configuration provided"),
    );
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 502,
      message: "Could not open the billing portal",
    });
  });
});
