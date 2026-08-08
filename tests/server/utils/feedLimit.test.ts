import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirst = vi.fn();
const mockCount = vi.fn();

// select().from().where() resolves to the aggregate count rows.
const mockWhere = vi.fn(() => mockCount());
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.stubGlobal("useDb", () => ({
  select: mockSelect,
  query: { feeds: { findFirst: mockFindFirst } },
}));

vi.mock("../../../server/utils/subscriptions", () => ({
  getAccountPlan: vi.fn(),
}));

import { assertWithinFeedLimit } from "../../../server/utils/feedLimit";
import { FREE_PLAN_FEED_LIMIT } from "../../../server/utils/planLimits";
import { getAccountPlan } from "../../../server/utils/subscriptions";

const mockGetAccountPlan = vi.mocked(getAccountPlan);

function planFor(plan: "free" | "pro") {
  return {
    plan,
    status: plan === "pro" ? "active" : "none",
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
}

function feedCountIs(value: number) {
  mockCount.mockResolvedValue([{ value }]);
}

const NEW_URL = "https://example.com/new-feed.xml";

describe("assertWithinFeedLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(undefined);
    // Re-establish a default each run so a prior test's count can't leak in
    // (clearAllMocks clears call history but not return values).
    feedCountIs(0);
  });

  it("allows a Free account below the limit", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    feedCountIs(FREE_PLAN_FEED_LIMIT - 1);
    await expect(assertWithinFeedLimit(1, NEW_URL)).resolves.toBeUndefined();
  });

  it("rejects a Free account exactly at the limit adding a new source", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    feedCountIs(FREE_PLAN_FEED_LIMIT);
    await expect(assertWithinFeedLimit(1, NEW_URL)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("rejects a Free account over the limit", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    feedCountIs(FREE_PLAN_FEED_LIMIT + 5);
    await expect(assertWithinFeedLimit(1, NEW_URL)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("allows a Free account at the limit to re-add a URL it already follows", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    feedCountIs(FREE_PLAN_FEED_LIMIT);
    mockFindFirst.mockResolvedValue({ id: 7, userId: 1, url: NEW_URL });
    await expect(assertWithinFeedLimit(1, NEW_URL)).resolves.toBeUndefined();
    // Re-adds are updates, not new sources — the count is never consulted.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  // Guards a shape the driver never actually returns (count(*) always yields a
  // row) — locks in the fail-closed intent so the ?? 0 fail-open can't return.
  it("fails closed (500) when the feed count row is missing", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("free"));
    mockCount.mockResolvedValue([]);
    await expect(assertWithinFeedLimit(1, NEW_URL)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("allows a Pro account far over the Free limit without counting feeds", async () => {
    mockGetAccountPlan.mockResolvedValue(planFor("pro"));
    await expect(assertWithinFeedLimit(1, NEW_URL)).resolves.toBeUndefined();
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
