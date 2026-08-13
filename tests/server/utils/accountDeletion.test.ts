import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCancelActiveSubscription,
  mockDeleteClerkUser,
  mockDelete,
  mockWhere,
} = vi.hoisted(() => ({
  mockCancelActiveSubscription: vi.fn(),
  mockDeleteClerkUser: vi.fn(),
  mockDelete: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("../../../server/utils/subscriptions", () => ({
  cancelActiveSubscription: mockCancelActiveSubscription,
}));
vi.mock("../../../server/utils/clerk", () => ({
  deleteClerkUser: mockDeleteClerkUser,
}));

vi.stubGlobal("useDb", () => ({ delete: mockDelete }));

import { deleteUserAccount } from "../../../server/utils/accountDeletion";

const user = { id: 7, providerId: "user_abc" } as never;

describe("deleteUserAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
  });

  it("cancels billing, deletes the db row, then deletes the clerk user", async () => {
    const event = { context: { user } };
    await deleteUserAccount(event as never, user);
    expect(mockCancelActiveSubscription).toHaveBeenCalledWith(7);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteClerkUser).toHaveBeenCalledWith(event, "user_abc");
  });

  it("cancels the subscription before deleting the db row", async () => {
    const order: string[] = [];
    mockCancelActiveSubscription.mockImplementation(async () => {
      order.push("cancel");
    });
    mockWhere.mockImplementation(async () => {
      order.push("db-delete");
    });
    mockDeleteClerkUser.mockImplementation(async () => {
      order.push("clerk-delete");
    });
    await deleteUserAccount({ context: { user } } as never, user);
    expect(order).toEqual(["cancel", "db-delete", "clerk-delete"]);
  });

  it("does not delete the db row when cancelling the subscription throws", async () => {
    mockCancelActiveSubscription.mockRejectedValue(new Error("stripe down"));
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).rejects.toThrow("stripe down");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });
});
