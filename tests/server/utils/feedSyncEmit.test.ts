import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  emitOnDemandSyncEvent,
  ON_DEMAND_SYNC_PRIORITY,
} from "../../../server/utils/feedSyncEmit";

describe("emitOnDemandSyncEvent", () => {
  const mockSend = vi.fn();
  const client = { send: mockSend } as unknown as Parameters<
    typeof emitOnDemandSyncEvent
  >[0];

  beforeEach(() => vi.resetAllMocks());

  const eventData = {
    userId: 1,
    feedId: 2,
    sourceType: "rss" as const,
    mode: "on-demand" as const,
  };

  it("sends the sync-feed event with elevated priority", async () => {
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "evt-1" });

    await emitOnDemandSyncEvent(client, eventData);

    expect(mockSend).toHaveBeenCalledWith("sync-feed", {
      data: eventData,
      priority: ON_DEMAND_SYNC_PRIORITY,
    });
  });

  it("returns the eventId on success", async () => {
    mockSend.mockResolvedValue({ sendStatus: "succeeded", eventId: "evt-9" });

    const eventId = await emitOnDemandSyncEvent(client, eventData);
    expect(eventId).toBe("evt-9");
  });

  it("throws when the send status is not succeeded", async () => {
    mockSend.mockResolvedValue({ sendStatus: "failed", eventId: "" });

    await expect(emitOnDemandSyncEvent(client, eventData)).rejects.toThrow(
      /status=failed/,
    );
  });

  it("propagates a rejection from the client", async () => {
    mockSend.mockRejectedValue(new Error("network down"));

    await expect(emitOnDemandSyncEvent(client, eventData)).rejects.toThrow(
      "network down",
    );
  });
});
