import { randomBytes } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encryptToken,
  decryptToken,
  isEncryptedToken,
} from "../../../../server/utils/crypto";

const mockReadBody = vi.fn();
const mockCreateBlueskySession = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockFeedsFindFirst = vi.fn();

// 32 bytes of hex — a valid AES-256-GCM key so encryptToken (a real
// server/utils/crypto call, auto-imported the same way as createBlueskySession)
// works end-to-end in these tests.
const TEST_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");

vi.stubGlobal("readBody", mockReadBody);
vi.stubGlobal("createBlueskySession", mockCreateBlueskySession);
vi.stubGlobal("useDb", () => ({
  insert: mockInsert,
  update: mockUpdate,
  query: { feeds: { findFirst: mockFeedsFindFirst } },
}));
// encryptToken is a real server/utils/crypto call (Nitro auto-imports
// server/utils/* into server/api routes; vitest doesn't run that transform,
// so it's shimmed here as a global backed by the real implementation) —
// letting the genuine encryption run end-to-end is what the tests below verify.
vi.stubGlobal("encryptToken", encryptToken);

// The connect flow also creates a feed row for the account's timeline (see
// integrationFeedCreation.ts) — mocking only its plan-cap dependency (rather
// than the whole module) lets that real orchestration logic run end-to-end,
// the same way createFeedForUser's own dependencies are mocked in
// feeds.post.test.ts.
vi.mock("../../../../server/utils/feedLimit", () => ({
  assertWithinFeedLimit: vi.fn(),
}));

import handler from "../../../../server/api/auth/bluesky.post";
import { assertWithinFeedLimit } from "../../../../server/utils/feedLimit";

const mockAssertWithinFeedLimit = vi.mocked(assertWithinFeedLimit);

const mockSession = {
  did: "did:plc:abc123",
  handle: "you.bsky.social",
  accessJwt: "access-jwt-token",
  refreshJwt: "refresh-jwt-token",
};

describe("POST /api/auth/bluesky", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_TOKEN_ENCRYPTION_KEY);
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
    mockCreateBlueskySession.mockResolvedValue(mockSession);
    mockReadBody.mockResolvedValue({
      handle: "you.bsky.social",
      appPassword: "xxxx-xxxx-xxxx-xxxx",
    });
    mockAssertWithinFeedLimit.mockResolvedValue(undefined);
    // No existing bluesky feed by default — most tests exercise the
    // first-connect (insert) path; the reconnect (update-in-place) path is
    // covered by its own dedicated test below.
    mockFeedsFindFirst.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws 401 when not authenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when handle is missing", async () => {
    mockReadBody.mockResolvedValue({ appPassword: "xxxx-xxxx-xxxx-xxxx" });
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when app password is missing", async () => {
    mockReadBody.mockResolvedValue({ handle: "you.bsky.social" });
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 when body is empty", async () => {
    mockReadBody.mockResolvedValue({});
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("calls createBlueskySession with the provided handle and app password", async () => {
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockCreateBlueskySession).toHaveBeenCalledWith(
      "you.bsky.social",
      "xxxx-xxxx-xxxx-xxxx",
    );
  });

  it("inserts the integration with the correct provider and user", async () => {
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    // One insert for the integrations row, one for the feed created from it
    // (see integrationFeedCreation.ts) — the integration's onConflictDoUpdate
    // call is still calls[0] since it runs before feed creation.
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        provider: "bluesky",
        providerAccountId: "did:plc:abc123",
        providerUsername: "you.bsky.social",
      }),
    );
  });

  it("encrypts the access JWT, refresh JWT, and app password before storing them (never stores plaintext)", async () => {
    const event = { context: { user: { id: 1 } } };
    await handler(event);

    const storedValues = mockValues.mock.calls[0][0];
    expect(storedValues.accessToken).not.toBe(mockSession.accessJwt);
    expect(storedValues.refreshToken).not.toBe(mockSession.refreshJwt);
    expect(storedValues.tokenSecret).not.toBe("xxxx-xxxx-xxxx-xxxx");
    expect(isEncryptedToken(storedValues.accessToken)).toBe(true);
    expect(isEncryptedToken(storedValues.refreshToken)).toBe(true);
    expect(isEncryptedToken(storedValues.tokenSecret)).toBe(true);
    expect(decryptToken(storedValues.accessToken)).toBe(mockSession.accessJwt);
    expect(decryptToken(storedValues.refreshToken)).toBe(
      mockSession.refreshJwt,
    );
    expect(decryptToken(storedValues.tokenSecret)).toBe("xxxx-xxxx-xxxx-xxxx");
  });

  it("also encrypts the access JWT, refresh JWT, and app password on the reconnect (onConflictDoUpdate) branch", async () => {
    // Every reconnect of an already-connected account goes through this
    // branch, not the insert values above — it must never regress to
    // plaintext on its own.
    const event = { context: { user: { id: 1 } } };
    await handler(event);

    const conflictSet = mockOnConflictDoUpdate.mock.calls[0][0].set;
    expect(isEncryptedToken(conflictSet.accessToken)).toBe(true);
    expect(isEncryptedToken(conflictSet.refreshToken)).toBe(true);
    expect(isEncryptedToken(conflictSet.tokenSecret)).toBe(true);
    expect(decryptToken(conflictSet.accessToken)).toBe(mockSession.accessJwt);
    expect(decryptToken(conflictSet.refreshToken)).toBe(mockSession.refreshJwt);
    expect(decryptToken(conflictSet.tokenSecret)).toBe("xxxx-xxxx-xxxx-xxxx");
  });

  it("returns ok and the Bluesky handle on success", async () => {
    const event = { context: { user: { id: 1 } } };
    const result = await handler(event);
    expect(result).toEqual({ ok: true, handle: "you.bsky.social" });
  });

  it("trims whitespace from handle and app password", async () => {
    mockReadBody.mockResolvedValue({
      handle: "  you.bsky.social  ",
      appPassword: "  xxxx-xxxx-xxxx-xxxx  ",
    });
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockCreateBlueskySession).toHaveBeenCalledWith(
      "you.bsky.social",
      "xxxx-xxxx-xxxx-xxxx",
    );
  });

  it("clears any previously-recorded sync failure on the integration on (re)connect", async () => {
    const event = { context: { user: { id: 1 } } };
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

  it("also clears any previously-recorded sync failure on the user's Bluesky feeds", async () => {
    const event = { context: { user: { id: 1 } } };
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

  it("creates a feed for the connected account's timeline on connect", async () => {
    // This is the crux of the "connecting never creates a feed" bug: without
    // wiring createBlueskyFeedForUser into this handler, only the
    // integrations insert above ever happens and this assertion fails.
    const event = { context: { user: { id: 1 } } };
    await handler(event);

    expect(mockAssertWithinFeedLimit).toHaveBeenCalledWith(
      1,
      "https://bsky.app/profile/you.bsky.social",
    );
    expect(mockValues).toHaveBeenCalledWith({
      userId: 1,
      url: "https://bsky.app/profile/you.bsky.social",
      title: "you.bsky.social",
      source: "bluesky",
    });
  });

  it("still returns ok when the free-plan feed cap blocks feed creation", async () => {
    mockAssertWithinFeedLimit.mockRejectedValue(
      Object.assign(new Error("cap exceeded"), { statusCode: 403 }),
    );
    const event = { context: { user: { id: 1 } } };

    const result = await handler(event);

    expect(result).toEqual({ ok: true, handle: "you.bsky.social" });
  });

  it("updates the existing bluesky feed in place on reconnect, instead of inserting a duplicate", async () => {
    // A handle rename or reconnecting a different Bluesky account must reuse
    // the single existing bluesky feed row rather than leaving a stale one
    // behind that keeps double-syncing the same timeline.
    mockFeedsFindFirst.mockResolvedValue({ id: 42 });
    const event = { context: { user: { id: 1 } } };

    await handler(event);

    // Only the integration insert — no second feed insert.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bsky.app/profile/you.bsky.social",
        title: "you.bsky.social",
      }),
    );
  });
});
