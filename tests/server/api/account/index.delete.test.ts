import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeleteUserAccount } = vi.hoisted(() => ({
  mockDeleteUserAccount: vi.fn(),
}));

vi.mock("../../../../server/utils/accountDeletion", () => ({
  deleteUserAccount: mockDeleteUserAccount,
}));

import handler from "../../../../server/api/account/index.delete";

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

  it("deletes the account and returns ok", async () => {
    const user = { id: 1, providerId: "user_abc" };
    const event = { context: { user } };
    const result = await handler(event);
    expect(mockDeleteUserAccount).toHaveBeenCalledWith(event, user);
    expect(result).toEqual({ ok: true });
  });
});
