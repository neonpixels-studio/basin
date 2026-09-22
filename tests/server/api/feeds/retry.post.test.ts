import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

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

import handler, {
  retryCooldownStore,
} from "../../../../server/api/feeds/[id]/retry.post";

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
    // The cooldown store is module-level state (see the export's comment in
    // retry.post.ts) — without clearing it, whichever test in this file first
    // reaches the emit step for feed 3 would consume its window and 429 every
    // test after it.
    retryCooldownStore.clear();
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

  it("throws 400 for a non-integer id", async () => {
    await expect(handler(makeEvent({ id: 1 }, "3.5"))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("throws 400 for a negative id", async () => {
    await expect(handler(makeEvent({ id: 1 }, "-1"))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("throws 400 for a zero id", async () => {
    await expect(handler(makeEvent({ id: 1 }, "0"))).rejects.toMatchObject({
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

  it("looks up the feed scoped to both the feed id and the requesting user's id", async () => {
    mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
    await handler(makeEvent({ id: 7 }, "3"));

    const [{ where }] = mockFindFirst.mock.calls[0];
    // Parse the built predicate's SQL and bound params so this actually
    // proves both the feed id and the user id are enforced in the query —
    // not just that some `where` clause exists.
    const { sql, params } = new PgDialect().sqlToQuery(where);
    const idPlaceholder = sql.match(/"feeds"\."id" = \$(\d+)/);
    const userIdPlaceholder = sql.match(/"feeds"\."user_id" = \$(\d+)/);
    expect(idPlaceholder).not.toBeNull();
    expect(userIdPlaceholder).not.toBeNull();
    expect(params[Number(idPlaceholder![1]) - 1]).toBe(3);
    expect(params[Number(userIdPlaceholder![1]) - 1]).toBe(7);
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

  it("allows retrying a youtube feed", async () => {
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

  describe("retry cooldown", () => {
    it("throws 429 on a second retry request for the same feed within the window", async () => {
      mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);

      await handler(makeEvent({ id: 7 }, "3"));
      await expect(handler(makeEvent({ id: 7 }, "3"))).rejects.toMatchObject({
        statusCode: 429,
      });

      // The cooldown only guards the emit step — the first request already
      // queued its event before the second was rejected.
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("releases the cooldown slot when the emit itself fails, so the next attempt is not falsely 429'd", async () => {
      mockFindFirst.mockResolvedValue(FAILING_RSS_FEED);
      mockSend.mockResolvedValueOnce({ sendStatus: "failed", eventId: "" });

      await expect(handler(makeEvent({ id: 7 }, "3"))).rejects.toMatchObject({
        statusCode: 502,
      });

      mockSend.mockResolvedValueOnce({
        sendStatus: "succeeded",
        eventId: "evt-2",
      });
      const result = await handler(makeEvent({ id: 7 }, "3"));
      expect(result).toMatchObject({ queued: true });
    });

    it("does not consume the cooldown when an earlier attempt was rejected before the emit step", async () => {
      // The first call is rejected for being unpaused-but-not-failing (409),
      // never reaching assertNotOnCooldown — so it must not burn the window
      // for the second, valid attempt.
      mockFindFirst.mockResolvedValueOnce({
        ...FAILING_RSS_FEED,
        syncStatus: "ok",
      });
      await expect(handler(makeEvent({ id: 7 }, "3"))).rejects.toMatchObject({
        statusCode: 409,
      });

      mockFindFirst.mockResolvedValueOnce(FAILING_RSS_FEED);
      const result = await handler(makeEvent({ id: 7 }, "3"));
      expect(result).toMatchObject({ queued: true });
    });

    it("allows concurrent retries for two different feeds", async () => {
      mockFindFirst.mockResolvedValueOnce(FAILING_RSS_FEED);
      await handler(makeEvent({ id: 7 }, "3"));

      mockFindFirst.mockResolvedValueOnce({
        id: 4,
        source: "youtube",
        syncStatus: "error",
        paused: false,
      });
      const result = await handler(makeEvent({ id: 7 }, "4"));

      expect(result).toMatchObject({ queued: true });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
