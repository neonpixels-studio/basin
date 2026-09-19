import { describe, it, expect, vi, beforeEach } from "vitest";

// Deliberately does NOT mock feedLimit: this closes the loop between the two
// otherwise-mocked layers by exercising the real plan/count guard through
// createFeedForUser, so deleting the guard call would fail here.
const mockCount = vi.fn();
const mockWhere = vi.fn(() => mockCount());
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockFeedsFindFirst = vi.fn();
const mockReturning = vi.fn();
const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
const mockValues = vi.fn(() => ({
  onConflictDoUpdate: mockOnConflictDoUpdate,
}));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.stubGlobal("useDb", () => ({
  insert: mockInsert,
  select: mockSelect,
  query: { feeds: { findFirst: mockFeedsFindFirst } },
}));

vi.mock("../../../server/utils/subscriptions", () => ({
  getAccountPlan: vi.fn(),
}));

vi.mock("../../../server/utils/feedValidator", () => ({
  validateFeedContent: vi.fn(),
  fetchFeedBody: vi.fn(),
  FEED_FETCH_PROXY_URL: "",
}));

vi.mock("../../../server/utils/feedSourceDetector", () => ({
  detectFeedSource: vi.fn(),
}));

import { DrizzleQueryError } from "drizzle-orm";
import { createFeedForUser } from "../../../server/utils/feedCreation";
import { FREE_PLAN_FEED_LIMIT } from "../../../server/utils/planLimits";
import {
  FEED_LIMIT_DB_ERROR_MARKER,
  FEED_LIMIT_SQLSTATE,
} from "../../../server/utils/feedLimit";
import { getAccountPlan } from "../../../server/utils/subscriptions";
import {
  validateFeedContent,
  fetchFeedBody,
} from "../../../server/utils/feedValidator";
import { detectFeedSource } from "../../../server/utils/feedSourceDetector";

const mockGetAccountPlan = vi.mocked(getAccountPlan);
const mockValidateFeedContent = vi.mocked(validateFeedContent);
const mockFetchFeedBody = vi.mocked(fetchFeedBody);
const mockDetectFeedSource = vi.mocked(detectFeedSource);

const NEW_URL = "https://example.com/brand-new.xml";

// Builds the driver error the trigger produces: a Postgres error carrying the
// marker message and the check_violation SQLSTATE, wrapped by drizzle in a
// DrizzleQueryError whose own message is the failed SQL (with params).
function drizzleErrorWithCause(cause: Error) {
  return new DrizzleQueryError("insert into feeds ... ", [], cause);
}

function capViolationCause() {
  const cause = new Error(FEED_LIMIT_DB_ERROR_MARKER) as Error & {
    code: string;
  };
  cause.code = FEED_LIMIT_SQLSTATE;
  return cause;
}

function planFor(plan: "free" | "pro") {
  return {
    plan,
    status: plan === "pro" ? "active" : "none",
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
}

describe("createFeedForUser plan cap (real feedLimit guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeedsFindFirst.mockResolvedValue(undefined);
    mockCount.mockResolvedValue([{ value: 0 }]);
    // Happy-path add mocks so an allowed call runs through to the insert.
    mockValidateFeedContent.mockResolvedValue(true);
    mockFetchFeedBody.mockResolvedValue("<rss></rss>");
    mockDetectFeedSource.mockReturnValue("rss");
    mockReturning.mockResolvedValue([
      { id: 1, userId: 1, url: NEW_URL, source: "rss", sourceOverride: null },
    ]);
  });

  it("rejects a Free user at the cap with 403 before validating or inserting", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT }]);

    await expect(createFeedForUser(1, NEW_URL)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockValidateFeedContent).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("maps the DB cap trigger's error to a 403 when a raced add slips past the pre-check", async () => {
    // Under the cap, so the app-level pre-check passes and the add reaches the
    // insert — but a concurrent add committed first, so the DB trigger rejects
    // this one. createFeedForUser must surface that as the same 403.
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT - 1 }]);
    mockReturning.mockRejectedValueOnce(
      drizzleErrorWithCause(capViolationCause()),
    );

    await expect(createFeedForUser(1, NEW_URL)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("does not swallow an unrelated insert error as a cap rejection", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT - 1 }]);
    mockReturning.mockRejectedValueOnce(
      drizzleErrorWithCause(new Error("connection reset")),
    );

    // Rethrown unchanged (as the wrapped driver error), never remapped to 403.
    const error = await createFeedForUser(1, NEW_URL).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toMatchObject({ cause: { message: "connection reset" } });
    expect(error).not.toHaveProperty("statusCode", 403);
  });

  it("does not treat the marker text in an unrelated error as a cap rejection", async () => {
    // A URL param can contain the marker string, which drizzle embeds in the
    // wrapper message; without the SQLSTATE guard that would false-positive.
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT - 1 }]);
    const cause = new Error("connection reset") as Error & { code: string };
    cause.code = "08006";
    mockReturning.mockRejectedValueOnce(
      new DrizzleQueryError(
        `insert into feeds url=${FEED_LIMIT_DB_ERROR_MARKER}`,
        [],
        cause,
      ),
    );

    const error = await createFeedForUser(1, NEW_URL).catch(
      (thrown: unknown) => thrown,
    );
    // Pin that the driver error propagated unchanged (not resolved, not 403).
    expect(error).toMatchObject({ cause: { message: "connection reset" } });
    expect(error).not.toHaveProperty("statusCode", 403);
  });

  it("allows the last slot but rejects the one over the cap (boundary)", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));

    // One below the cap: the add is allowed and reaches the insert.
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT - 1 }]);
    await expect(createFeedForUser(1, NEW_URL)).resolves.toMatchObject({
      detectedSource: "rss",
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // At the cap: the next new source is refused.
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT }]);
    await expect(createFeedForUser(1, NEW_URL)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
