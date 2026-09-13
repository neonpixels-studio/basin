import { randomBytes } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encryptToken,
  decryptToken,
  isEncryptedToken,
} from "../../../../../server/utils/crypto";

const mockGetQuery = vi.fn();
const mockGetCookie = vi.fn();
const mockDeleteCookie = vi.fn();
const mockGetRequestURL = vi.fn();
const mockSendRedirect = vi.fn();
const CONFIGURED_CALLBACK_URL =
  "https://basin.example.com/api/auth/youtube/callback";
const mockBuildYouTubeCallbackUrl = vi.fn(() => CONFIGURED_CALLBACK_URL);
const mockExchangeCodeForTokens = vi.fn();
const mockGetYouTubeChannelHandle = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockFeedsFindMany = vi.fn();
const mockCount = vi.fn();
const mockSelectWhere = vi.fn(() => mockCount());
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

// 32 bytes of hex — a valid AES-256-GCM key so encryptToken (a real
// server/utils/crypto call, auto-imported the same way as exchangeCodeForTokens)
// works end-to-end in these tests.
const TEST_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");

vi.stubGlobal("getQuery", mockGetQuery);
vi.stubGlobal("getCookie", mockGetCookie);
vi.stubGlobal("deleteCookie", mockDeleteCookie);
vi.stubGlobal("getRequestURL", mockGetRequestURL);
vi.stubGlobal("sendRedirect", mockSendRedirect);
vi.stubGlobal("buildYouTubeCallbackUrl", mockBuildYouTubeCallbackUrl);
vi.stubGlobal("exchangeCodeForTokens", mockExchangeCodeForTokens);
vi.stubGlobal("getYouTubeChannelHandle", mockGetYouTubeChannelHandle);
vi.stubGlobal("useDb", () => ({
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
  query: { feeds: { findMany: mockFeedsFindMany } },
}));
// encryptToken is a real server/utils/crypto call (Nitro auto-imports
// server/utils/* into server/api routes; vitest doesn't run that transform,
// so it's shimmed here as a global backed by the real implementation) —
// letting the genuine encryption run end-to-end is what the tests below verify.
vi.stubGlobal("encryptToken", encryptToken);

// The connect flow also creates feeds rows from the account's subscriptions
// (see integrationFeedCreation.ts) — mocking its own external-service and
// plan-lookup dependencies here (rather than the whole module) lets that real
// orchestration logic run end-to-end, the same way createFeedForUser's own
// dependencies are mocked in feeds.post.test.ts.
vi.mock("../../../../../server/utils/youtubeAdapter", () => ({
  fetchYouTubeSubscriptions: vi.fn(),
}));
vi.mock("../../../../../server/utils/subscriptions", () => ({
  getAccountPlan: vi.fn(),
}));

import handler from "../../../../../server/api/auth/youtube/callback.get";
import { fetchYouTubeSubscriptions } from "../../../../../server/utils/youtubeAdapter";
import { getAccountPlan } from "../../../../../server/utils/subscriptions";
import { FREE_PLAN_FEED_LIMIT } from "../../../../../server/utils/planLimits";

const mockFetchYouTubeSubscriptions = vi.mocked(fetchYouTubeSubscriptions);
const mockGetAccountPlan = vi.mocked(getAccountPlan);

const mockTokens = {
  access_token: "access-abc",
  refresh_token: "refresh-xyz",
  expires_in: 3600,
  scope:
    "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile",
  token_type: "Bearer",
};

describe("GET /api/auth/youtube/callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_TOKEN_ENCRYPTION_KEY);
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
    mockSendRedirect.mockResolvedValue(undefined);
    mockGetRequestURL.mockReturnValue(
      new URL("https://attacker.example.com/api/auth/youtube/callback"),
    );
    mockBuildYouTubeCallbackUrl.mockReturnValue(CONFIGURED_CALLBACK_URL);
    mockGetYouTubeChannelHandle.mockResolvedValue("@testchannel");
    mockExchangeCodeForTokens.mockResolvedValue(mockTokens);
    // No subscriptions by default so existing assertions on insert/update call
    // counts (which predate feed creation) keep holding; tests below override
    // this to exercise feed creation itself. Plan defaults to "pro" so the
    // (unused, in the default case) free-plan capacity queries never need
    // their own setup unless a test opts into them.
    mockFetchYouTubeSubscriptions.mockResolvedValue([]);
    mockGetAccountPlan.mockResolvedValue({
      plan: "pro",
      status: "active",
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    mockFeedsFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue([{ value: 0 }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws 401 when not authenticated", async () => {
    const event = { context: { user: null } };
    mockGetQuery.mockReturnValue({ code: "abc", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when state param is missing", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "abc" });
    mockGetCookie.mockReturnValue("state123");
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when code is missing", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when state does not match cookie", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "abc", state: "bad-state" });
    mockGetCookie.mockReturnValue("state123");
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("deletes the oauth_state_youtube cookie on a valid flow", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    expect(mockDeleteCookie).toHaveBeenCalledWith(event, "oauth_state_youtube");
  });

  it("exchanges the code and inserts the integration", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith(
      "auth-code",
      CONFIGURED_CALLBACK_URL,
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        provider: "youtube",
        providerUsername: "@testchannel",
      }),
    );
  });

  it("exchanges using the configured redirect_uri, never the request origin", async () => {
    // The token-exchange redirect_uri must byte-match the one sent at
    // initiation. Both derive from buildYouTubeCallbackUrl, so a forged Host
    // header on this callback request cannot change it.
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    const [, passedRedirectUri] = mockExchangeCodeForTokens.mock.calls[0];
    expect(passedRedirectUri).toBe(CONFIGURED_CALLBACK_URL);
    // Fails loudly if request-origin derivation is ever reintroduced.
    expect(mockGetRequestURL).not.toHaveBeenCalled();
  });

  it("propagates the 500 when the site URL is unconfigured, without exchanging the code", async () => {
    mockBuildYouTubeCallbackUrl.mockImplementation(() => {
      throw Object.assign(new Error("Server configuration error"), {
        statusCode: 500,
      });
    });
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 500 });
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("encrypts the access and refresh tokens before storing them (never stores plaintext)", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);

    const storedValues = mockValues.mock.calls[0][0];
    expect(storedValues.accessToken).not.toBe(mockTokens.access_token);
    expect(storedValues.refreshToken).not.toBe(mockTokens.refresh_token);
    expect(isEncryptedToken(storedValues.accessToken)).toBe(true);
    expect(isEncryptedToken(storedValues.refreshToken)).toBe(true);
    expect(decryptToken(storedValues.accessToken)).toBe(
      mockTokens.access_token,
    );
    expect(decryptToken(storedValues.refreshToken)).toBe(
      mockTokens.refresh_token,
    );
  });

  it("also encrypts the access and refresh tokens on the reconnect (onConflictDoUpdate) branch", async () => {
    // Every reconnect of an already-connected account goes through this
    // branch, not the insert values above — it must never regress to
    // plaintext on its own.
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);

    const conflictSet = mockOnConflictDoUpdate.mock.calls[0][0].set;
    expect(isEncryptedToken(conflictSet.accessToken)).toBe(true);
    expect(isEncryptedToken(conflictSet.refreshToken)).toBe(true);
    expect(decryptToken(conflictSet.accessToken)).toBe(mockTokens.access_token);
    expect(decryptToken(conflictSet.refreshToken)).toBe(
      mockTokens.refresh_token,
    );
  });

  it("stores a null refreshToken as null (no encryption of a missing value)", async () => {
    // This documents pre-existing behavior, not something introduced by
    // encryption: Google only returns refresh_token on first consent, so a
    // reconnect without a fresh refresh_token already nulled this column
    // before this change. Out of scope here — see PR description.
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    mockExchangeCodeForTokens.mockResolvedValue({
      ...mockTokens,
      refresh_token: undefined,
    });
    await handler(event);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null }),
    );
  });

  it("stores scopes split by space", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [
          "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/userinfo.profile",
        ],
      }),
    );
  });

  it("redirects to /settings on success", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    expect(mockSendRedirect).toHaveBeenCalledWith(
      event,
      "/settings/connections",
    );
  });

  it("clears any previously-recorded sync failure on the integration on (re)connect", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          syncStatus: "ok",
          syncError: null,
          syncFailedAt: null,
        }),
      }),
    );
  });

  it("also clears any previously-recorded sync failure on the user's YouTube feeds", async () => {
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        syncStatus: "ok",
        syncError: null,
        syncFailedAt: null,
      }),
    );
  });

  it("creates a feed for every subscribed YouTube channel on connect", async () => {
    // This is the crux of the "connecting never creates a feed" bug: without
    // wiring createYouTubeFeedsForUser into the callback, only the
    // integrations insert below ever happens and this assertion fails.
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
      { channelId: "UC2", title: "Channel Two" },
    ]);
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");
    await handler(event);

    expect(mockFetchYouTubeSubscriptions).toHaveBeenCalledWith(
      mockTokens.access_token,
    );
    // One insert for the integrations row, one batched insert for every
    // subscribed channel (see integrationFeedCreation.ts's chunking).
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockValues).toHaveBeenCalledWith([
      { userId: 1, source: "youtube", url: "UC1", title: "Channel One" },
      { userId: 1, source: "youtube", url: "UC2", title: "Channel Two" },
    ]);
  });

  it("skips a channel over the free-plan cap without failing the redirect", async () => {
    mockFetchYouTubeSubscriptions.mockResolvedValue([
      { channelId: "UC1", title: "Channel One" },
      { channelId: "UC2", title: "Channel Two" },
    ]);
    mockGetAccountPlan.mockResolvedValue({
      plan: "free",
      status: "none",
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    // Already one under the cap, so only the first channel fits.
    mockCount.mockResolvedValue([{ value: FREE_PLAN_FEED_LIMIT - 1 }]);
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");

    await handler(event);

    expect(mockSendRedirect).toHaveBeenCalledWith(
      event,
      "/settings/connections",
    );
    // Integration insert plus one batched insert for the channel under the cap.
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("still redirects when fetching subscriptions fails", async () => {
    mockFetchYouTubeSubscriptions.mockRejectedValue(
      new Error("Subscriptions API error: 500"),
    );
    const event = { context: { user: { id: 1 } } };
    mockGetQuery.mockReturnValue({ code: "auth-code", state: "state123" });
    mockGetCookie.mockReturnValue("state123");

    await expect(handler(event)).resolves.toBeUndefined();
    expect(mockSendRedirect).toHaveBeenCalledWith(
      event,
      "/settings/connections",
    );
  });
});
