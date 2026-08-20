import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeleteUser, mockClerkClient, mockVerifyWebhook } = vi.hoisted(
  () => {
    const mockDeleteUser = vi.fn();
    const mockClerkClient = vi.fn(() => ({
      users: { deleteUser: mockDeleteUser },
    }));
    const mockVerifyWebhook = vi.fn();
    return { mockDeleteUser, mockClerkClient, mockVerifyWebhook };
  },
);

vi.mock("@clerk/nuxt/server", () => ({ clerkClient: mockClerkClient }));
vi.mock("@clerk/nuxt/webhooks", () => ({ verifyWebhook: mockVerifyWebhook }));

const runtimeConfig = { clerk: { webhookSigningSecret: "whsec_test" } };
vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);

import {
  deleteClerkUser,
  verifyClerkWebhook,
} from "../../../server/utils/clerk";

describe("deleteClerkUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the client from the event and deletes the given provider id", async () => {
    const event = { context: {} };
    await deleteClerkUser(event as never, "user_abc");
    expect(mockClerkClient).toHaveBeenCalledWith(event);
    expect(mockDeleteUser).toHaveBeenCalledWith("user_abc");
  });
});

describe("verifyClerkWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeConfig.clerk.webhookSigningSecret = "whsec_test";
  });

  it("returns the verified event from the Clerk SDK", async () => {
    const event = { context: {} };
    const verified = { type: "user.deleted", data: { id: "user_abc" } };
    mockVerifyWebhook.mockResolvedValue(verified);

    const result = await verifyClerkWebhook(event as never);

    expect(mockVerifyWebhook).toHaveBeenCalledWith(event);
    expect(result).toBe(verified);
  });

  it("throws a 500 (not a bad signature) when the signing secret is missing", async () => {
    runtimeConfig.clerk.webhookSigningSecret = "";
    const error = await verifyClerkWebhook({ context: {} } as never).catch(
      (caught: { statusCode: number; message: string }) => caught,
    );

    expect(error).toMatchObject({ statusCode: 500 });
    expect(error.message).toContain("NUXT_CLERK_WEBHOOK_SIGNING_SECRET");
    expect(mockVerifyWebhook).not.toHaveBeenCalled();
  });
});
