import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockSend, mockFindMany } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@netlify/async-workloads", () => {
  class AsyncWorkloadsClient {
    send = mockSend;
  }
  return { AsyncWorkloadsClient };
});

vi.stubGlobal("useDb", () => ({
  query: {
    feeds: { findMany: mockFindMany },
  },
}));

import handler from "../../../server/api/feed-sync.post";

function makeEvent(user: Record<string, unknown> | null) {
  return { context: { user } };
}

const RSS_FEED = { id: 1, source: "rss" };
const PODCAST_FEED = { id: 2, source: "podcast" };

describe("POST /api/feed-sync", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "evt-123" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws 401 when unauthenticated", async () => {
    await expect(handler(makeEvent(null))).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("returns queued:0 when the user has no syncable feeds", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await handler(makeEvent({ id: 1 }));
    expect(result).toEqual({ queued: 0, failed: 0, eventIds: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("emits one event per syncable feed", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED, PODCAST_FEED]);

    const result = await handler(makeEvent({ id: 5 }));
    expect(result.queued).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.eventIds).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("sends events with mode on-demand and elevated priority", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED]);

    await handler(makeEvent({ id: 5 }));

    expect(mockSend).toHaveBeenCalledWith("sync-feed", {
      data: { userId: 5, feedId: 1, sourceType: "rss", mode: "on-demand" },
      priority: 25,
    });
  });

  it("excludes paused feeds from the on-demand queue", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED]);

    await handler(makeEvent({ id: 5 }));

    const [callArgs] = mockFindMany.mock.calls[0];
    const { sql, params } = new PgDialect().sqlToQuery(callArgs.where);
    // Assert the value bound to the paused predicate specifically is `false`, so
    // the check can't pass on an unrelated boolean param being false.
    const pausedPlaceholder = sql.match(/"feeds"\."paused" = \$(\d+)/);
    expect(pausedPlaceholder).not.toBeNull();
    expect(params[Number(pausedPlaceholder![1]) - 1]).toBe(false);
  });

  it("throws 502 when every feed emit fails", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED, PODCAST_FEED]);
    mockSend.mockResolvedValue({ sendStatus: "failed", eventId: "" });

    await expect(handler(makeEvent({ id: 5 }))).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("throws 502 and logs each failure when every emit rejects", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED, PODCAST_FEED]);
    mockSend.mockRejectedValue(new Error("emit exploded"));

    await expect(handler(makeEvent({ id: 5 }))).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("continues processing remaining feeds when one feed's emit fails", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED, PODCAST_FEED]);
    mockSend
      .mockRejectedValueOnce(new Error("emit exploded"))
      .mockResolvedValueOnce({ sendStatus: "succeeded", eventId: "evt-ok" });

    const result = await handler(makeEvent({ id: 5 }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result.queued).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.eventIds).toEqual(["evt-ok"]);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(loggedPayload).toMatchObject({
      event: "feed-sync.emit-failed",
      userId: 5,
      feedId: RSS_FEED.id,
    });
  });

  it("tolerates a non-Error rejection and still reports the partial outcome", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED, PODCAST_FEED]);
    mockSend
      .mockRejectedValueOnce("string failure")
      .mockResolvedValueOnce({ sendStatus: "succeeded", eventId: "evt-ok" });

    const result = await handler(makeEvent({ id: 5 }));

    expect(result.queued).toBe(1);
    expect(result.failed).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(loggedPayload.error).toBe("string failure");
  });

  it("returns the eventIds from the client", async () => {
    mockFindMany.mockResolvedValue([RSS_FEED]);
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "abc-xyz" });

    const result = await handler(makeEvent({ id: 5 }));
    expect(result.eventIds).toContain("abc-xyz");
  });
});
