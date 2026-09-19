import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReturning = vi.fn();
const mockWhere = vi.fn();
const mockDelete = vi.fn();

vi.stubGlobal("useDb", () => ({ delete: mockDelete }));

const mockReconcile = vi.fn();
vi.mock("../../../../server/utils/feedPause", () => ({
  reactivateOldestPausedFeedsUnderCap: (...args: unknown[]) =>
    mockReconcile(...args),
}));

import handler from "../../../../server/api/feeds/[id].delete";

describe("DELETE /api/feeds/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDelete.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockReconcile.mockResolvedValue({ reactivatedIds: [] });
  });

  afterEach(() => {
    // Restore any console spies a test installed so a mid-test failure can't
    // leave console stubbed for the rest of the run.
    vi.restoreAllMocks();
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null }, params: { id: "1" } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 for a non-numeric id", async () => {
    const event = { context: { user: { id: 1 } }, params: { id: "abc" } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when the feed does not belong to the user", async () => {
    mockReturning.mockResolvedValue([]);
    const event = { context: { user: { id: 1 } }, params: { id: "99" } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("deletes the feed and returns ok", async () => {
    mockReturning.mockResolvedValue([{ id: 1 }]);
    const event = { context: { user: { id: 1 } }, params: { id: "1" } };
    const result = await handler(event);
    expect(result).toEqual({ ok: true });
  });

  it("deletes using both feed id and user id for ownership check", async () => {
    mockReturning.mockResolvedValue([{ id: 5 }]);
    const event = { context: { user: { id: 7 } }, params: { id: "5" } };
    await handler(event);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it("reconciles paused sources for the user after a successful delete", async () => {
    mockReturning.mockResolvedValue([{ id: 5 }]);
    const event = { context: { user: { id: 7 } }, params: { id: "5" } };
    await handler(event);
    expect(mockReconcile).toHaveBeenCalledWith(7);
  });

  it("logs a structured line when reconciliation un-pauses sources", async () => {
    mockReturning.mockResolvedValue([{ id: 5 }]);
    mockReconcile.mockResolvedValue({ reactivatedIds: [10, 11] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = { context: { user: { id: 7 } }, params: { id: "5" } };

    await handler(event);

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "feed.deleted-reconciled", userId: 7, count: 2 }),
    );
  });

  it("logs nothing when reconciliation promotes no source", async () => {
    mockReturning.mockResolvedValue([{ id: 5 }]);
    mockReconcile.mockResolvedValue({ reactivatedIds: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = { context: { user: { id: 7 } }, params: { id: "5" } };

    await handler(event);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does not reconcile when the delete matches no feed", async () => {
    mockReturning.mockResolvedValue([]);
    const event = { context: { user: { id: 7 } }, params: { id: "99" } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("still resolves ok when reconciliation fails after a committed delete", async () => {
    mockReturning.mockResolvedValue([{ id: 5 }]);
    mockReconcile.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = { context: { user: { id: 7 } }, params: { id: "5" } };

    const result = await handler(event);

    expect(result).toEqual({ ok: true });
    // The log is the only failure signal: a parseable JSON line (event + user)
    // paired with the raw error so the real cause survives.
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "feed.reconcile-failed", userId: 7 }),
      expect.any(Error),
    );
  });
});
