import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/utils/markAllRead");

import { markAllItemsRead } from "../../../server/utils/markAllRead";
import handler from "../../../server/api/mark-all-read.post";

const mockMarkAllItemsRead = vi.mocked(markAllItemsRead);

function makeEvent(
  user: Record<string, unknown> | null,
  body: Record<string, unknown> = {},
) {
  return { context: { user }, body };
}

describe("POST /api/mark-all-read", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMarkAllItemsRead.mockResolvedValue(0);
  });

  it("throws 401 when unauthenticated", async () => {
    await expect(handler(makeEvent(null))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockMarkAllItemsRead).not.toHaveBeenCalled();
  });

  it("marks all read for the authenticated user and returns the count", async () => {
    mockMarkAllItemsRead.mockResolvedValue(12);

    const result = await handler(makeEvent({ id: 42 }));

    expect(mockMarkAllItemsRead).toHaveBeenCalledWith(42, {
      filter: undefined,
    });
    expect(result).toEqual({ ok: true, marked: 12 });
  });

  it("passes a string filter through to the bulk update", async () => {
    await handler(makeEvent({ id: 1 }, { filter: "podcast" }));
    expect(mockMarkAllItemsRead).toHaveBeenCalledWith(1, {
      filter: "podcast",
    });
  });

  it("ignores a non-string filter", async () => {
    await handler(makeEvent({ id: 1 }, { filter: 123 }));
    expect(mockMarkAllItemsRead).toHaveBeenCalledWith(1, {
      filter: undefined,
    });
  });
});
