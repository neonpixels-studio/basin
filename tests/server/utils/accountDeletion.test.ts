import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { users } from "../../../server/db/schema";

const { mockDeleteBillingRecords, mockDeleteClerkUser, mockDelete, mockWhere } =
  vi.hoisted(() => ({
    mockDeleteBillingRecords: vi.fn(),
    mockDeleteClerkUser: vi.fn(),
    mockDelete: vi.fn(),
    mockWhere: vi.fn(),
  }));

vi.mock("../../../server/utils/subscriptions", () => ({
  deleteBillingRecords: mockDeleteBillingRecords,
}));
vi.mock("../../../server/utils/clerk", () => ({
  deleteClerkUser: mockDeleteClerkUser,
}));

vi.stubGlobal("useDb", () => ({ delete: mockDelete }));

import { deleteUserAccount } from "../../../server/utils/accountDeletion";

const user = { id: 7, providerId: "user_abc" } as never;
const dialect = new PgDialect();

// Compare two drizzle SQL conditions by their rendered SQL + params, so the
// test fails if the delete ever targets the wrong column or user id.
function sameCondition(actual: unknown, expected: unknown): boolean {
  const a = dialect.sqlToQuery(actual as never);
  const b = dialect.sqlToQuery(expected as never);
  return (
    a.sql === b.sql && JSON.stringify(a.params) === JSON.stringify(b.params)
  );
}

describe("deleteUserAccount", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDelete.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
  });

  it("purges billing, deletes the db row for the right user, then deletes the clerk user", async () => {
    const event = { context: { user } };
    await deleteUserAccount(event as never, user);
    expect(mockDeleteBillingRecords).toHaveBeenCalledWith(7);
    expect(mockDelete).toHaveBeenCalledWith(users);
    expect(sameCondition(mockWhere.mock.calls[0][0], eq(users.id, 7))).toBe(
      true,
    );
    expect(mockDeleteClerkUser).toHaveBeenCalledWith(event, "user_abc");
  });

  it("purges billing before deleting the db row before deleting the clerk user", async () => {
    const order: string[] = [];
    mockDeleteBillingRecords.mockImplementation(async () => {
      order.push("billing");
    });
    mockWhere.mockImplementation(async () => {
      order.push("db-delete");
    });
    mockDeleteClerkUser.mockImplementation(async () => {
      order.push("clerk-delete");
    });
    await deleteUserAccount({ context: { user } } as never, user);
    expect(order).toEqual(["billing", "db-delete", "clerk-delete"]);
  });

  it("does not delete the db row when purging billing throws", async () => {
    mockDeleteBillingRecords.mockRejectedValue(new Error("stripe down"));
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).rejects.toThrow("stripe down");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("still resolves (data already gone) when the clerk deletion fails, logging for reconciliation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDeleteClerkUser.mockRejectedValue(new Error("clerk 500"));
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
