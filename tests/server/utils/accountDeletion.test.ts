import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { users } from "../../../server/db/schema";
import { TombstonePepperError } from "../../../server/utils/tombstoneHash";

const {
  mockDeleteBillingRecords,
  mockDeleteClerkUser,
  mockRecordDeletionTombstone,
  mockFindUserByProviderId,
  mockDelete,
  mockWhere,
} = vi.hoisted(() => ({
  mockDeleteBillingRecords: vi.fn(),
  mockDeleteClerkUser: vi.fn(),
  mockRecordDeletionTombstone: vi.fn(),
  mockFindUserByProviderId: vi.fn(),
  mockDelete: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("../../../server/utils/subscriptions", () => ({
  deleteBillingRecords: mockDeleteBillingRecords,
}));
vi.mock("../../../server/utils/clerk", () => ({
  deleteClerkUser: mockDeleteClerkUser,
}));
vi.mock("../../../server/utils/tombstone", () => ({
  recordDeletionTombstone: mockRecordDeletionTombstone,
}));
vi.mock("../../../server/utils/auth", () => ({
  findUserByProviderId: mockFindUserByProviderId,
}));

vi.stubGlobal("useDb", () => ({ delete: mockDelete }));

import {
  deleteUserAccount,
  deleteAccountByProviderId,
} from "../../../server/utils/accountDeletion";

const user = { id: 7, providerId: "user_abc" } as never;
const dialect = new PgDialect();

// Compare two drizzle SQL conditions by their rendered SQL + params, so the
// test fails if the delete ever targets the wrong column or user id.
function sameCondition(actual: unknown, expected: unknown): boolean {
  const actualQuery = dialect.sqlToQuery(actual as never);
  const expectedQuery = dialect.sqlToQuery(expected as never);
  return (
    actualQuery.sql === expectedQuery.sql &&
    JSON.stringify(actualQuery.params) === JSON.stringify(expectedQuery.params)
  );
}

describe("deleteUserAccount", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDelete.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
  });

  // Unconditionally clear env stubs so a failing assertion in the pepper test
  // can't leak an empty TOMBSTONE_ID_PEPPER into later tests (which now hit the
  // real hashProviderId preflight in purgeAccountData).
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("purges billing, tombstones and deletes the db row for the right user, then deletes the clerk user", async () => {
    const event = { context: { user } };
    await deleteUserAccount(event as never, user);
    expect(mockDeleteBillingRecords).toHaveBeenCalledWith(7);
    expect(mockRecordDeletionTombstone).toHaveBeenCalledWith("user_abc");
    expect(mockDelete).toHaveBeenCalledWith(users);
    expect(sameCondition(mockWhere.mock.calls[0][0], eq(users.id, 7))).toBe(
      true,
    );
    expect(mockDeleteClerkUser).toHaveBeenCalledWith(event, "user_abc");
  });

  it("tombstones the provider id before deleting the db row so no session can resurrect it", async () => {
    const order: string[] = [];
    mockDeleteBillingRecords.mockImplementation(async () => {
      order.push("billing");
    });
    mockRecordDeletionTombstone.mockImplementation(async () => {
      order.push("tombstone");
    });
    mockWhere.mockImplementation(async () => {
      order.push("db-delete");
    });
    mockDeleteClerkUser.mockImplementation(async () => {
      order.push("clerk-delete");
    });
    await deleteUserAccount({ context: { user } } as never, user);
    expect(order).toEqual([
      "billing",
      "tombstone",
      "db-delete",
      "clerk-delete",
    ]);
  });

  it("does not delete the db row or the clerk user when tombstoning throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRecordDeletionTombstone.mockRejectedValue(new Error("tombstone down"));
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).rejects.toThrow("tombstone down");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("recording the deletion tombstone failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("does not delete the db row when purging billing throws", async () => {
    mockDeleteBillingRecords.mockRejectedValue(new Error("stripe down"));
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).rejects.toThrow("stripe down");
    expect(mockRecordDeletionTombstone).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("throws before purging billing when the tombstone pepper is misconfigured", async () => {
    // A missing/short pepper makes hashProviderId throw. The preflight probe must
    // run before deleteBillingRecords so a config error never leaves billing
    // irreversibly purged with the tombstone unrecorded.
    vi.stubEnv("TOMBSTONE_ID_PEPPER", "");
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).rejects.toThrow(TombstonePepperError);
    expect(mockDeleteBillingRecords).not.toHaveBeenCalled();
    expect(mockRecordDeletionTombstone).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("logs the half-deleted state and rethrows when the db delete fails after billing was purged", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWhere.mockRejectedValue(new Error("db down"));
    await expect(
      deleteUserAccount({ context: { user } } as never, user),
    ).rejects.toThrow("db down");
    expect(mockDeleteBillingRecords).toHaveBeenCalledWith(7);
    expect(mockRecordDeletionTombstone).toHaveBeenCalledWith("user_abc");
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("deleting the users row failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
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

describe("deleteAccountByProviderId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDelete.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
  });

  it("purges billing, tombstones and deletes the db row for the resolved user, without touching Clerk", async () => {
    mockFindUserByProviderId.mockResolvedValue(user);

    await deleteAccountByProviderId("user_abc");

    expect(mockFindUserByProviderId).toHaveBeenCalledWith("user_abc");
    expect(mockDeleteBillingRecords).toHaveBeenCalledWith(7);
    expect(mockRecordDeletionTombstone).toHaveBeenCalledWith("user_abc");
    expect(mockDelete).toHaveBeenCalledWith(users);
    expect(sameCondition(mockWhere.mock.calls[0][0], eq(users.id, 7))).toBe(
      true,
    );
    // The Clerk identity is already gone on Clerk's side — never re-delete it.
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("tombstones the provider id (but purges nothing) when no user row matches", async () => {
    mockFindUserByProviderId.mockResolvedValue(undefined);

    await deleteAccountByProviderId("user_ghost");

    expect(mockRecordDeletionTombstone).toHaveBeenCalledWith("user_ghost");
    expect(mockDeleteBillingRecords).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockDeleteClerkUser).not.toHaveBeenCalled();
  });

  it("does not delete the db row when purging billing throws", async () => {
    mockFindUserByProviderId.mockResolvedValue(user);
    mockDeleteBillingRecords.mockRejectedValue(new Error("stripe down"));

    await expect(deleteAccountByProviderId("user_abc")).rejects.toThrow(
      "stripe down",
    );
    expect(mockRecordDeletionTombstone).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
