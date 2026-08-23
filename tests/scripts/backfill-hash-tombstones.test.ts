import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  backfillRow,
  backfillRowReportingFailure,
} from "../../scripts/backfill-hash-tombstones";
import {
  hashProviderId,
  isHashedProviderId,
} from "../../server/utils/tombstoneHash";

const TEST_PEPPER = "test-tombstone-pepper-0123456789";

// A minimal stand-in for neon's tagged-template SQL client: records the query
// text and interpolated values from each call and returns a canned result, so
// backfillRow's SQL can be tested without a real DB connection.
function createFakeSql(results: unknown[][]) {
  const calls: unknown[][] = [];
  const statements: string[] = [];
  let callIndex = 0;

  const fakeSql = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      statements.push(strings.join("?"));
      const result = results[callIndex] ?? [];
      callIndex += 1;
      return result;
    },
  );

  return { fakeSql, calls, statements };
}

describe("backfillRow", () => {
  beforeEach(() => {
    vi.stubEnv("TOMBSTONE_ID_PEPPER", TEST_PEPPER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves an already-hashed row untouched and runs no SQL", async () => {
    const { fakeSql, calls } = createFakeSql([]);
    const alreadyHashed = hashProviderId("user_abc");

    const outcome = await backfillRow(fakeSql, { providerId: alreadyHashed });

    expect(outcome).toBe("already-hashed");
    expect(calls).toHaveLength(0);
  });

  it("migrates a legacy raw row, deleting the raw id and inserting its hash", async () => {
    const { fakeSql, calls } = createFakeSql([[{ provider_id: "user_abc" }]]);

    const outcome = await backfillRow(fakeSql, { providerId: "user_abc" });

    expect(outcome).toBe("migrated");
    const interpolatedValues = calls[0];
    expect(interpolatedValues).toContain("user_abc");
    expect(interpolatedValues).toContain(hashProviderId("user_abc"));
    expect(
      interpolatedValues.some((value) => isHashedProviderId(value as string)),
    ).toBe(true);
  });

  it("deletes the raw row and re-inserts under the hash preserving deleted_at, with a conflict guard", async () => {
    const { fakeSql, statements } = createFakeSql([
      [{ provider_id: "user_abc" }],
    ]);

    await backfillRow(fakeSql, { providerId: "user_abc" });

    const statement = statements[0];
    expect(statement).toContain("DELETE FROM deletion_tombstones");
    expect(statement).toContain(
      "INSERT INTO deletion_tombstones (provider_id, deleted_at)",
    );
    expect(statement).toContain("deleted_at FROM deleted");
    expect(statement).toContain("ON CONFLICT (provider_id) DO NOTHING");
  });

  it("reports skipped-not-found when the raw row was already removed concurrently", async () => {
    const { fakeSql } = createFakeSql([[]]);

    const outcome = await backfillRow(fakeSql, { providerId: "user_abc" });

    expect(outcome).toBe("skipped-not-found");
  });
});

describe("backfillRowReportingFailure", () => {
  beforeEach(() => {
    vi.stubEnv("TOMBSTONE_ID_PEPPER", TEST_PEPPER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 'failed' and logs instead of throwing when a row errors", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const throwingSql = vi.fn(async () => {
      throw new Error("connection lost");
    });

    const outcome = await backfillRowReportingFailure(
      throwingSql as never,
      { providerId: "user_abc" },
      0,
    );

    expect(outcome).toBe("failed");
    expect(consoleError).toHaveBeenCalled();
    // The raw provider id must never appear in logs — the whole point of #215.
    const loggedText = consoleError.mock.calls.map(String).join(" ");
    expect(loggedText).not.toContain("user_abc");
    consoleError.mockRestore();
  });
});
