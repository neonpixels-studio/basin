import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeleteUserAccount } = vi.hoisted(() => ({
  mockDeleteUserAccount: vi.fn(),
}));

vi.mock("../../../../server/utils/accountDeletion", () => ({
  deleteUserAccount: mockDeleteUserAccount,
}));

// The reverification gate pulls in server/utils/clerk, which imports the Clerk
// SDK (unresolvable `#imports` under vitest); stub it — this test never calls it.
vi.mock("@clerk/nuxt/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@clerk/nuxt/webhooks", () => ({ verifyWebhook: vi.fn() }));

import handler from "../../../../server/api/account/index.delete";

const user = { id: 1, providerId: "user_abc" };

// A session that reverified a first factor `minutes` ago. `-1` for the second
// factor mirrors Clerk's "no second factor" sentinel.
function eventWithVerificationAge(minutes: number) {
  return {
    context: {
      user,
      auth: () => ({ sessionClaims: { fva: [minutes, -1] } }),
    },
  };
}

describe("DELETE /api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteUserAccount.mockResolvedValue(undefined);
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
  });

  it("deletes the account and returns ok when recently reverified", async () => {
    const event = eventWithVerificationAge(0);
    const result = await handler(event);
    expect(mockDeleteUserAccount).toHaveBeenCalledWith(event, user);
    expect(result).toEqual({ ok: true });
  });

  it("throws 403 without deleting when the verification is stale", async () => {
    const event = eventWithVerificationAge(30);
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
  });

  it("throws 403 without deleting when the session carries no fva claim", async () => {
    const event = { context: { user, auth: () => ({ sessionClaims: {} }) } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
  });
});
