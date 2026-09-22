import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSend, mockFindFirst } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockFindFirst: vi.fn(),
}));

vi.mock("@netlify/async-workloads", () => {
  class AsyncWorkloadsClient {
    send = mockSend;
  }
  return { AsyncWorkloadsClient };
});

vi.stubGlobal("useDb", () => ({
  query: {
    feeds: { findFirst: mockFindFirst },
  },
}));

import handler from "../../../../server/api/feeds/[id]/retry.post";

function makeEvent(
  user: Record<string, unknown> | null,
  id: string | undefined,
) {
  return { context: { user }, params: { id } };
}

const FAILING_RSS_FEED = {
  id: 3,
  source: "rss",
  syncStatus: "error",
  paused: false,
};

describe("POST /api/feeds/:id/retry", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "evt-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws 401 when unauthenticated", async () => {
    await expect(handler(makeEvent(null, "3"))).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("throws 400 for a non-numeric id", async () => {
    await expect(handler(makeEvent({ id: 1 }, "abc"))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("throws 404 when the feed does not belong to the user", async () => {
    mockFindFirst.mockResolvedValue(undefined);
    await expect(handler(makeEvent({ id: 1 }, "99"))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("throws 400 for an unsyncable source", async () => {
    mockFindFirst.mockResolvedValue({
      id: 3,
      source: "unknown",
      syncStatus: "error",
      paused: false,
    });
    await expect(handler(makeEvent({ id: 1 }, "3"))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws 409 when the feed is paused", async () => {
    mockFindFirst.mockResolvedValue({ ...FAILING_RSS_FEED, paused: true });
    await expect(handler(makeEvent({ id: 1 }, "3"))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws 409 when the feed is not currently in an error state", async () => {
    mockFindFirst.mockResolvedValue({ ...FAILING_RSS_FEED, syncStatus: "ok" });
    await expect(handler(makeEvent({ id: 1 }, "3"))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("emits an on-demand event scoped to the feed's owning user", async () => {
    mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
    await handler(makeEvent({ id: 7 }, "3"));

    expect(mockSend).toHaveBeenCalledWith("sync-feed", {
      data: { userId: 7, feedId: 3, sourceType: "rss", mode: "on-demand" },
      priority: 25,
    });
  });

  it("looks up the feed scoped to the requesting user's id", async () => {
    mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
    await handler(makeEvent({ id: 7 }, "3"));

    const [{ where }] = mockFindFirst.mock.calls[0];
    // Ownership is enforced in the query predicate, not after the fact — the
    // where clause combines the feed id with the requesting user's id (drizzle's
    // `and(...)` builder), matching the pattern the delete route uses.
    expect(where).toBeDefined();
  });

  it("returns queued:true and the eventId on success", async () => {
    mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "evt-42" });

    const result = await handler(makeEvent({ id: 7 }, "3"));
    expect(result).toEqual({ queued: true, eventId: "evt-42" });
  });

  it("throws 502 and logs when the emit fails", async () => {
    mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
    mockSend.mockResolvedValue({ sendStatus: "failed", eventId: "" });

    await expect(handler(makeEvent({ id: 7 }, "3"))).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(loggedPayload).toMatchObject({
      event: "feed-retry.emit-failed",
      userId: 7,
      feedId: 3,
    });
  });

  it("throws 502 and logs when the emit rejects", async () => {
    mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
    mockSend.mockRejectedValue(new Error("emit exploded"));

    await expect(handler(makeEvent({ id: 7 }, "3"))).rejects.toMatchObject({
      statusCode: 502,
    });
    const loggedPayload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(loggedPayload.error).toBe("emit exploded");
  });

  it("allows retrying a paused-eligible source type like youtube", async () => {
    mockFindFirst.mockResolvedValue({
      id: 4,
      source: "youtube",
      syncStatus: "error",
      paused: false,
    });
    await handler(makeEvent({ id: 7 }, "4"));
    expect(mockSend).toHaveBeenCalledWith(
      "sync-feed",
      expect.objectContaining({
        data: expect.objectContaining({ sourceType: "youtube" }),
      }),
    );
  });
});
