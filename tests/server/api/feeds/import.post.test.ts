import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../server/utils/feedCreation", () => ({
  createFeedForUser: vi.fn(),
}));

import handler from "../../../../server/api/feeds/import.post";
import { createFeedForUser } from "../../../../server/utils/feedCreation";
import { FREE_PLAN_FEED_LIMIT } from "../../../../server/utils/planLimits";

const mockCreateFeedForUser = vi.mocked(createFeedForUser);

const CAP_MESSAGE = `Free plan is limited to ${FREE_PLAN_FEED_LIMIT} sources; upgrade to Pro for unlimited sources`;

const defaultReadBody = globalThis.readBody;

function makeEvent(user: unknown = { id: 1 }, body: unknown = {}) {
  return { context: { user }, body };
}

const VALID_OPML = `<opml><body>
  <outline title="Feed One" xmlUrl="https://one.example.com/feed.xml"/>
  <outline title="Feed Two" xmlUrl="https://two.example.com/feed.xml"/>
</body></opml>`;

describe("POST /api/feeds/import", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.readBody = defaultReadBody;
  });

  afterEach(() => {
    globalThis.readBody = defaultReadBody;
    vi.restoreAllMocks();
  });

  it("throws 401 when unauthenticated", async () => {
    const event = makeEvent(null, { opml: VALID_OPML });
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when opml is missing", async () => {
    await expect(handler(makeEvent({ id: 1 }, {}))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("throws 400 when opml is blank", async () => {
    await expect(
      handler(makeEvent({ id: 1 }, { opml: "   " })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 413 when the opml body exceeds the size cap, without parsing it", async () => {
    const oversized = "a".repeat(2 * 1024 * 1024 + 1);
    await expect(
      handler(makeEvent({ id: 1 }, { opml: oversized })),
    ).rejects.toMatchObject({ statusCode: 413 });
    expect(mockCreateFeedForUser).not.toHaveBeenCalled();
  });

  it("throws 400 when the document is not valid OPML", async () => {
    await expect(
      handler(makeEvent({ id: 1 }, { opml: "not opml at all" })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("adds every feed outline via createFeedForUser and returns them as imported", async () => {
    mockCreateFeedForUser.mockImplementation(async (userId, url) => ({
      id: url.includes("one") ? 1 : 2,
      userId,
      url,
      title: null,
      source: "rss",
      sourceOverride: null,
      detectedSource: "rss",
    }));

    const result = await handler(makeEvent({ id: 1 }, { opml: VALID_OPML }));

    expect(mockCreateFeedForUser).toHaveBeenCalledWith(
      1,
      "https://one.example.com/feed.xml",
    );
    expect(mockCreateFeedForUser).toHaveBeenCalledWith(
      1,
      "https://two.example.com/feed.xml",
    );
    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    expect(result.truncatedCount).toBe(0);
  });

  it("skips feeds that fail validation instead of aborting the whole import", async () => {
    mockCreateFeedForUser.mockImplementation(async (userId, url) => {
      if (url.includes("two")) {
        throw Object.assign(new Error("URL does not point to a valid feed"), {
          statusCode: 422,
          statusMessage: "URL does not point to a valid feed",
        });
      }
      return {
        id: 1,
        userId,
        url,
        title: null,
        source: "rss",
        sourceOverride: null,
        detectedSource: "rss",
      };
    });

    const result = await handler(makeEvent({ id: 1 }, { opml: VALID_OPML }));

    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        url: "https://two.example.com/feed.xml",
        title: "Feed Two",
        reason: "URL does not point to a valid feed",
      },
    ]);
    expect(result.truncatedCount).toBe(0);
  });

  it("surfaces a cap-rejected add's statusMessage as the skip reason", async () => {
    mockCreateFeedForUser.mockImplementation(async (userId, url) => {
      if (url.includes("two")) {
        throw Object.assign(new Error("Free plan limit"), {
          statusCode: 403,
          statusMessage: CAP_MESSAGE,
        });
      }
      return {
        id: 1,
        userId,
        url,
        title: null,
        source: "rss",
        sourceOverride: null,
        detectedSource: "rss",
      };
    });

    const result = await handler(makeEvent({ id: 1 }, { opml: VALID_OPML }));

    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        url: "https://two.example.com/feed.xml",
        title: "Feed Two",
        reason: CAP_MESSAGE,
      },
    ]);
  });

  it("returns an empty result for OPML with no feed outlines", async () => {
    const result = await handler(
      makeEvent(
        { id: 1 },
        { opml: `<opml><body><outline text="Empty Folder"/></body></opml>` },
      ),
    );

    expect(result).toEqual({ imported: [], skipped: [], truncatedCount: 0 });
    expect(mockCreateFeedForUser).not.toHaveBeenCalled();
  });

  it("reports entries dropped by the MAX_OPML_ENTRIES cap as truncatedCount", async () => {
    mockCreateFeedForUser.mockImplementation(async (userId, url) => ({
      id: 1,
      userId,
      url,
      title: null,
      source: "rss",
      sourceOverride: null,
      detectedSource: "rss",
    }));

    const outlines = Array.from(
      { length: 60 },
      (_, index) => `<outline xmlUrl="https://example.com/${index}.xml"/>`,
    ).join("\n");
    const result = await handler(
      makeEvent({ id: 1 }, { opml: `<opml><body>${outlines}</body></opml>` }),
    );

    expect(result.imported).toHaveLength(50);
    expect(result.truncatedCount).toBe(10);
  });

  it("stops starting new adds once the import time budget is spent and reports the rest as truncated", async () => {
    let simulatedNow = 0;
    vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    mockCreateFeedForUser.mockImplementation(async (userId, url) => {
      // Exceed IMPORT_TIME_BUDGET_MS (8s) after the first entry completes so
      // the loop's next-iteration budget check breaks before entry two.
      simulatedNow += 9_000;
      return {
        id: 1,
        userId,
        url,
        title: null,
        source: "rss",
        sourceOverride: null,
        detectedSource: "rss",
      };
    });

    const result = await handler(makeEvent({ id: 1 }, { opml: VALID_OPML }));

    expect(mockCreateFeedForUser).toHaveBeenCalledTimes(1);
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.truncatedCount).toBe(1);
  });
});
