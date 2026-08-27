import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearFeedSyncFailures } from "../../../server/utils/feedSyncStatus";

function makeDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return {
    db: { update } as unknown as Parameters<typeof clearFeedSyncFailures>[0],
    update,
    set,
    where,
  };
}

describe("clearFeedSyncFailures", () => {
  beforeEach(() => vi.resetAllMocks());

  it("clears the failure display state and un-gates the retry backoff", async () => {
    const { db, set } = makeDb();

    await clearFeedSyncFailures(db, 1, "youtube");

    expect(set).toHaveBeenCalledWith({
      syncStatus: "ok",
      syncError: null,
      syncFailedAt: null,
      nextRetryAt: null,
    });
  });

  // consecutiveFailures must be preserved, not zeroed: a reconnect proves the
  // account works but not that every feed under it does, so a still-broken feed
  // gets one retry (nextRetryAt cleared) then jumps back to the backoff cap
  // instead of restarting the 15-minute ramp. Zeroing it here would regress
  // that — see UNGATED_SYNC_STATE in feedSyncBackoff.ts.
  it("preserves consecutiveFailures so a still-broken feed isn't fully forgiven", async () => {
    const { db, set } = makeDb();

    await clearFeedSyncFailures(db, 1, "youtube");

    expect(set.mock.calls[0][0]).not.toHaveProperty("consecutiveFailures");
  });

  it("scopes the update to a single db.update() call", async () => {
    const { db, update } = makeDb();

    await clearFeedSyncFailures(db, 1, "bluesky");

    expect(update).toHaveBeenCalledTimes(1);
  });
});
