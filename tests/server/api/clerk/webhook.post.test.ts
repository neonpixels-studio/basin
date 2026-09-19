import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockVerifyClerkWebhook, mockDeleteAccountByProviderId } = vi.hoisted(
  () => ({
    mockVerifyClerkWebhook: vi.fn(),
    mockDeleteAccountByProviderId: vi.fn(),
  }),
);
vi.mock("../../../../server/utils/clerk", () => ({
  verifyClerkWebhook: mockVerifyClerkWebhook,
}));
vi.mock("../../../../server/utils/accountDeletion", () => ({
  deleteAccountByProviderId: mockDeleteAccountByProviderId,
}));

import handler from "../../../../server/api/clerk/webhook.post";

describe("POST /api/clerk/webhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws 400 when signature verification fails, without leaking the SDK error", async () => {
    mockVerifyClerkWebhook.mockRejectedValue(
      new Error("No matching signature found"),
    );
    const error = await handler({}).catch((caught: Error) => caught);
    expect(error).toMatchObject({ statusCode: 400 });
    expect(error.message).toBe("Invalid Clerk webhook signature");
    expect(mockDeleteAccountByProviderId).not.toHaveBeenCalled();
  });

  it("propagates a 5xx from verification instead of masking it as a bad signature", async () => {
    // A missing NUXT_CLERK_WEBHOOK_SIGNING_SECRET surfaces as a 500 createError;
    // that's a misconfiguration, not a bad signature, so it must reach Clerk as
    // a retryable 5xx (Clerk won't retry a 400).
    mockVerifyClerkWebhook.mockRejectedValue(
      globalThis.createError({
        statusCode: 500,
        statusMessage:
          "Clerk is not configured: missing NUXT_CLERK_WEBHOOK_SIGNING_SECRET",
      }),
    );
    const error = await handler({}).catch((caught: Error) => caught);
    expect(error).toMatchObject({ statusCode: 500 });
    expect(mockDeleteAccountByProviderId).not.toHaveBeenCalled();
  });

  it("cascades cleanup for the deleted user on user.deleted", async () => {
    mockVerifyClerkWebhook.mockResolvedValue({
      type: "user.deleted",
      data: { id: "user_abc" },
    });
    const result = await handler({});
    expect(mockDeleteAccountByProviderId).toHaveBeenCalledWith("user_abc");
    expect(result).toEqual({ received: true });
  });

  it("acknowledges a user.deleted event that carries no user id without cleaning up", async () => {
    mockVerifyClerkWebhook.mockResolvedValue({
      type: "user.deleted",
      data: {},
    });
    const result = await handler({});
    expect(mockDeleteAccountByProviderId).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });

  it("ignores event types it doesn't handle", async () => {
    mockVerifyClerkWebhook.mockResolvedValue({
      type: "user.created",
      data: { id: "user_abc" },
    });
    const result = await handler({});
    expect(mockDeleteAccountByProviderId).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });
});
