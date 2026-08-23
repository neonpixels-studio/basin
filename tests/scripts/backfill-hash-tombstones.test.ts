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

// A minimal stand-in for neon's tagged-template SQL client: records the
// interpolated values from each call and returns a canned result, so
// backfillRow's UPDATE logic can be tested without a real DB connection.
function createFakeSql(results: unknown[][]) {
  const calls: unknown[][] = [];
  let callIndex = 0;

  const fakeSql = vi.fn(
    async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      const result = results[callIndex] ?? [];
      callIndex += 1;
      return result;
    },
  );

  return { fakeSql, calls };
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

    const outcome = await backfillRowReportingFailure(throwingSql as never, {
      providerId: "user_abc",
    });

    expect(outcome).toBe("failed");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
