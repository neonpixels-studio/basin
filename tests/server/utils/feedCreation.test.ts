import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReturning = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();

vi.stubGlobal("useDb", () => ({ insert: mockInsert }));

vi.mock("../../../server/utils/feedValidator", () => ({
  validateFeedContent: vi.fn(),
  fetchFeedBody: vi.fn(),
  FEED_FETCH_PROXY_URL: "",
}));

vi.mock("../../../server/utils/feedSourceDetector", () => ({
  detectFeedSource: vi.fn(),
}));

vi.mock("../../../server/utils/feedLimit", () => ({
  assertWithinFeedLimit: vi.fn(),
}));

import { createFeedForUser } from "../../../server/utils/feedCreation";
import {
  validateFeedContent,
  fetchFeedBody,
} from "../../../server/utils/feedValidator";
import { detectFeedSource } from "../../../server/utils/feedSourceDetector";
import { assertWithinFeedLimit } from "../../../server/utils/feedLimit";

const mockValidateFeedContent = vi.mocked(validateFeedContent);
const mockFetchFeedBody = vi.mocked(fetchFeedBody);
const mockDetectFeedSource = vi.mocked(detectFeedSource);
const mockAssertWithinFeedLimit = vi.mocked(assertWithinFeedLimit);

const RSS_BODY = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title></channel></rss>`;

const mockFeed = {
  id: 1,
  url: "https://example.com/feed.xml",
  source: "rss",
  sourceOverride: null,
  userId: 1,
};

describe("createFeedForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
    mockValidateFeedContent.mockResolvedValue(true);
    mockFetchFeedBody.mockResolvedValue(RSS_BODY);
    mockDetectFeedSource.mockReturnValue("rss");
    mockReturning.mockResolvedValue([mockFeed]);
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
  });

  it("inserts the feed and returns it with detectedSource", async () => {
    const result = await createFeedForUser(1, "https://example.com/feed.xml");
    expect(result).toMatchObject({ ...mockFeed, detectedSource: "rss" });
  });

  it("enforces the plan cap before any feed insert", async () => {
    mockAssertWithinFeedLimit.mockRejectedValue(
      Object.assign(new Error("over limit"), { statusCode: 403 }),
    );
    await expect(
      createFeedForUser(1, "https://example.com/feed.xml"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockValidateFeedContent).not.toHaveBeenCalled();
  });

  it("throws 422 when the URL does not point to a valid feed", async () => {
    mockValidateFeedContent.mockResolvedValue(false);
    await expect(
      createFeedForUser(1, "https://example.com/not-a-feed"),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("does not insert when validation fails", async () => {
    mockValidateFeedContent.mockResolvedValue(false);
    await expect(
      createFeedForUser(1, "https://example.com/not-a-feed"),
    ).rejects.toBeDefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws 504 when validation times out", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockValidateFeedContent.mockRejectedValue(abortError);

    await expect(
      createFeedForUser(1, "https://example.com/slow-feed"),
    ).rejects.toMatchObject({ statusCode: 504 });
  });

  it("uses sourceOverride when provided, ignoring detected source", async () => {
    mockDetectFeedSource.mockReturnValue("rss");
    const overriddenFeed = {
      ...mockFeed,
      source: "podcast",
      sourceOverride: "podcast",
    };
    mockReturning.mockResolvedValue([overriddenFeed]);

    await createFeedForUser(1, "https://example.com/feed.xml", "podcast");

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ source: "podcast", sourceOverride: "podcast" }),
    );
  });

  it("dedupes on userId + url via onConflictDoUpdate", async () => {
    await createFeedForUser(1, "https://example.com/feed.xml");
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
      }),
    );
  });

  // Documents pre-existing single-add upsert behavior (unchanged by the OPML
  // work): re-adding a URL without a sourceOverride resets any existing
  // override to auto-detected. OPML import calls createFeedForUser without a
  // sourceOverride for every entry, so re-importing a file containing a feed
  // the user manually overrode elsewhere will reset that override — this
  // test locks the behavior in so a future change to it is intentional, not
  // silent. See the note on createFeedForUser for the full explanation.
  it("resets an existing sourceOverride to null when re-adding without one", async () => {
    await createFeedForUser(1, "https://example.com/feed.xml");
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ sourceOverride: null }),
      }),
    );
  });

  // Re-adding a URL only reaches the upsert after validation proves the feed is
  // reachable again, so a repaired feed must be un-gated: without clearing
  // consecutiveFailures/nextRetryAt the scheduler leaves it backed off for up
  // to a day (see server/utils/feedSyncBackoff.ts).
  it("clears sync failure state and retry backoff when re-adding a repaired URL", async () => {
    await createFeedForUser(1, "https://example.com/feed.xml");
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          syncStatus: "ok",
          syncError: null,
          syncFailedAt: null,
          consecutiveFailures: 0,
          nextRetryAt: null,
        }),
      }),
    );
  });
});
