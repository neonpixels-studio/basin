import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../server/utils/markAllRead", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/utils/markAllRead")>();
  return { ...actual, markAllItemsRead: vi.fn() };
});

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
    vi.clearAllMocks();
    mockMarkAllItemsRead.mockResolvedValue(undefined);
  });

  it("throws 401 when unauthenticated", async () => {
    await expect(handler(makeEvent(null))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockMarkAllItemsRead).not.toHaveBeenCalled();
  });

  it("marks all read for the authenticated user with no filter", async () => {
    const result = await handler(makeEvent({ id: 42 }));

    expect(mockMarkAllItemsRead).toHaveBeenCalledWith(42, {
      filter: undefined,
    });
    expect(result).toEqual({ ok: true });
  });

  it("passes a recognized filter through to the bulk update", async () => {
    await handler(makeEvent({ id: 1 }, { filter: "podcast" }));
    expect(mockMarkAllItemsRead).toHaveBeenCalledWith(1, {
      filter: "podcast",
    });
  });

  it("throws 400 for an unrecognized filter instead of marking nothing", async () => {
    await expect(
      handler(makeEvent({ id: 1 }, { filter: "bogus" })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockMarkAllItemsRead).not.toHaveBeenCalled();
  });

  it("throws 400 for a non-string filter", async () => {
    await expect(
      handler(makeEvent({ id: 1 }, { filter: 123 })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockMarkAllItemsRead).not.toHaveBeenCalled();
  });

  it("throws 400 for an explicit null filter instead of widening to account-wide", async () => {
    await expect(
      handler(makeEvent({ id: 1 }, { filter: null })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockMarkAllItemsRead).not.toHaveBeenCalled();
  });
});
