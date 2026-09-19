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

// Keep isFeedLimitDbError/feedLimitExceededError real (the DB-cap-trigger test
// below exercises them) and only fake the network-backed pre-check.
vi.mock("../../../server/utils/feedLimit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../server/utils/feedLimit")>();
  return { ...actual, assertWithinFeedLimit: vi.fn() };
});

// @sentry/nuxt is mocked once, globally, in tests/setup.ts — see that file's
// comment for why a module-scoped mock here instead would silently miss the
// calls app/lib/sentry.ts makes. mockSentryScope is the shared `withScope`
// scope object, since extras are set on the scope, not passed to
// captureException directly.
import * as SentrySDK from "@sentry/nuxt";
import { mockSentryScope } from "../../setup";

import { createFeedForUser } from "../../../server/utils/feedCreation";
import {
  validateFeedContent,
  fetchFeedBody,
} from "../../../server/utils/feedValidator";
import { detectFeedSource } from "../../../server/utils/feedSourceDetector";
import {
  assertWithinFeedLimit,
  FEED_LIMIT_DB_ERROR_MARKER,
  FEED_LIMIT_SQLSTATE,
} from "../../../server/utils/feedLimit";

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

  // The conflict-update set clause covers two behaviors. First (pre-existing
  // single-add behavior, unchanged by the OPML work): re-adding a URL without a
  // sourceOverride resets any existing override to auto-detected — OPML import
  // calls createFeedForUser without a sourceOverride for every entry, so
  // re-importing a file containing a feed the user manually overrode elsewhere
  // resets that override. Second: it un-gates the retry backoff (nextRetryAt
  // null) and clears the failure display state so a repaired feed re-added
  // after its origin recovered syncs immediately instead of staying backed off
  // for up to a day. The explicit source/override are asserted too, pinning the
  // spread order in feedCreation.ts (shared defaults first, call-site values
  // last) so they can't be silently overridden by a future addition to the
  // shared state.
  it("resets sourceOverride and un-gates backoff on re-add", async () => {
    await createFeedForUser(1, "https://example.com/feed.xml");
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          source: "rss",
          sourceOverride: null,
          syncStatus: "ok",
          syncError: null,
          syncFailedAt: null,
          nextRetryAt: null,
        }),
      }),
    );
  });

  // consecutiveFailures must be preserved on re-add, not zeroed: validation
  // proves the URL is reachable, but the un-gated retry is what confirms the
  // feed actually works. Zeroing here would restart the backoff ramp for a
  // still-broken feed — see UNGATED_SYNC_STATE in feedSyncBackoff.ts.
  it("preserves consecutiveFailures on re-add", async () => {
    await createFeedForUser(1, "https://example.com/feed.xml");
    const { set } = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(set).not.toHaveProperty("consecutiveFailures");
  });

  it("reports to Sentry and maps the DB cap trigger to the same 403 the pre-check throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dbTriggerError = Object.assign(
      new Error(
        `insert violates check constraint: ${FEED_LIMIT_DB_ERROR_MARKER}`,
      ),
      { code: FEED_LIMIT_SQLSTATE },
    );
    mockReturning.mockRejectedValue(dbTriggerError);

    await expect(
      createFeedForUser(1, "https://example.com/feed.xml"),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(errorSpy).toHaveBeenCalled();
    expect(SentrySDK.captureException).toHaveBeenCalledWith(dbTriggerError);
    expect(mockSentryScope.setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, stage: "feed-cap-db-trigger" }),
    );
    errorSpy.mockRestore();
  });
});
