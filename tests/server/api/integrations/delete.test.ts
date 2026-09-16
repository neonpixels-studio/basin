import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { feeds, integrations } from "../../../../server/db/schema";

const mockReturning = vi.fn();
const mockWhere = vi.fn(() => ({ returning: mockReturning }));
// The feeds delete (added to reconcile dependent feeds on disconnect — see
// deleteIntegrationFeeds in the handler) is routed to its own mock chain,
// keyed off which table useDb().delete(...) was called with, so it can be
// asserted independently of the pre-existing integrations delete above.
const mockFeedsReturning = vi.fn();
const mockFeedsWhere = vi.fn(() => ({ returning: mockFeedsReturning }));
const mockDelete = vi.fn((table: unknown) =>
  table === feeds ? { where: mockFeedsWhere } : { where: mockWhere },
);

const mockDecryptTolerant = vi.fn((value: string) => value);
const mockDecryptNullable = vi.fn((value: string | null) => value);
const mockRevokeGoogleToken = vi.fn();
const mockDeleteBlueskySession = vi.fn();
const mockReconcile = vi.fn();

vi.stubGlobal("useDb", () => ({ delete: mockDelete }));

// Decryption is exercised by crypto.test.ts; here it's a pass-through so the
// test can assert exactly which token reaches the revocation call.
vi.stubGlobal("decryptTokenTolerant", mockDecryptTolerant);
vi.stubGlobal("decryptNullableTokenTolerant", mockDecryptNullable);
vi.stubGlobal("revokeGoogleToken", mockRevokeGoogleToken);
vi.stubGlobal("deleteBlueskySession", mockDeleteBlueskySession);

vi.mock("../../../../server/utils/feedPause", () => ({
  reactivateOldestPausedFeedsUnderCap: (...args: unknown[]) =>
    mockReconcile(...args),
}));

import handler from "../../../../server/api/integrations/[provider].delete";

const youtubeGrant = {
  accessToken: "yt-access",
  refreshToken: "yt-refresh",
};

const blueskyGrant = {
  accessToken: "bsky-access",
  refreshToken: "bsky-refresh-jwt",
};

describe("DELETE /api/integrations/:provider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockFeedsWhere.mockReturnValue({ returning: mockFeedsReturning });
    mockDelete.mockImplementation((table: unknown) =>
      table === feeds ? { where: mockFeedsWhere } : { where: mockWhere },
    );
    mockReturning.mockResolvedValue([youtubeGrant]);
    // No dependent feeds by default — most tests aren't exercising the
    // disconnect-cleanup path; the dedicated tests below override this.
    mockFeedsReturning.mockResolvedValue([]);
    mockReconcile.mockResolvedValue({ reactivatedIds: [] });
    mockDecryptTolerant.mockImplementation((value: string) => value);
    mockDecryptNullable.mockImplementation((value: string | null) => value);
    mockRevokeGoogleToken.mockResolvedValue(undefined);
    mockDeleteBlueskySession.mockResolvedValue(undefined);
  });

  it("throws 401 when unauthenticated", async () => {
    const event = { context: { user: null }, params: { provider: "youtube" } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 when provider param is missing", async () => {
    const event = { context: { user: { id: 1 } }, params: {} };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 for an unsupported provider without deleting or revoking", async () => {
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "mastodon" },
    };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRevokeGoogleToken).not.toHaveBeenCalled();
    expect(mockDeleteBlueskySession).not.toHaveBeenCalled();
  });

  it("deletes the integration and reports it revoked", async () => {
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    const result = await handler(event);
    expect(result).toEqual({ ok: true, revoked: true });
  });

  it("deletes both the integration and its dependent feeds for the correct provider and user", async () => {
    const event = {
      context: { user: { id: 7 } },
      params: { provider: "youtube" },
    };
    await handler(event);
    // Once for integrations, once for feeds (see deleteIntegrationFeeds).
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockFeedsWhere).toHaveBeenCalledTimes(1);
  });

  it("scopes the delete to the requesting user and provider", async () => {
    const event = {
      context: { user: { id: 42 } },
      params: { provider: "youtube" },
    };
    await handler(event);
    expect(mockWhere).toHaveBeenCalledWith(
      and(eq(integrations.userId, 42), eq(integrations.provider, "youtube")),
    );
  });

  it("revokes the YouTube grant using the refresh token", async () => {
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    await handler(event);
    expect(mockRevokeGoogleToken).toHaveBeenCalledTimes(1);
    expect(mockRevokeGoogleToken).toHaveBeenCalledWith("yt-refresh");
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it("falls back to the YouTube access token when no refresh token is stored", async () => {
    mockReturning.mockResolvedValue([
      { accessToken: "yt-access", refreshToken: null },
    ]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    await handler(event);
    expect(mockRevokeGoogleToken).toHaveBeenCalledWith("yt-access");
  });

  it("falls back to the access token when the refresh token is an empty string", async () => {
    mockReturning.mockResolvedValue([
      { accessToken: "yt-access", refreshToken: "" },
    ]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    await handler(event);
    expect(mockRevokeGoogleToken).toHaveBeenCalledWith("yt-access");
  });

  it("does not call revoke and reports not revoked when both YouTube tokens are empty", async () => {
    mockReturning.mockResolvedValue([{ accessToken: "", refreshToken: "" }]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    const result = await handler(event);
    expect(mockRevokeGoogleToken).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, revoked: false });
  });

  it("tears down the Bluesky session using the refresh JWT", async () => {
    mockReturning.mockResolvedValue([blueskyGrant]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "bluesky" },
    };
    const result = await handler(event);
    expect(mockDeleteBlueskySession).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlueskySession).toHaveBeenCalledWith("bsky-refresh-jwt");
    expect(result).toEqual({ ok: true, revoked: true });
  });

  it("skips Bluesky teardown when no refresh JWT is stored but still deletes", async () => {
    mockReturning.mockResolvedValue([
      { accessToken: "bsky-access", refreshToken: null },
    ]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "bluesky" },
    };
    const result = await handler(event);
    expect(mockDeleteBlueskySession).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, revoked: false });
  });

  it("still deletes the local row and reports not revoked when YouTube revocation fails", async () => {
    mockRevokeGoogleToken.mockRejectedValue(new Error("provider down"));
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    const result = await handler(event);
    expect(result).toEqual({ ok: true, revoked: false });
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it("still deletes the local row and reports not revoked when Bluesky teardown fails", async () => {
    mockReturning.mockResolvedValue([blueskyGrant]);
    mockDeleteBlueskySession.mockRejectedValue(new Error("bsky down"));
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "bluesky" },
    };
    const result = await handler(event);
    expect(result).toEqual({ ok: true, revoked: false });
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it("still deletes and reports not revoked when the stored token cannot be decrypted", async () => {
    mockDecryptNullable.mockImplementation(() => {
      throw new Error("TOKEN_ENCRYPTION_KEY is not set");
    });
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    const result = await handler(event);
    expect(result).toEqual({ ok: true, revoked: false });
    expect(mockRevokeGoogleToken).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it("skips revocation and still returns ok when no integration row exists", async () => {
    mockReturning.mockResolvedValue([]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };
    const result = await handler(event);
    expect(result).toEqual({ ok: true, revoked: false });
    expect(mockRevokeGoogleToken).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it("deletes the feeds created from this integration, scoped to the user and provider", async () => {
    // This is the crux of the "disconnect orphans feeds" bug: without
    // deleteIntegrationFeeds, the feeds created by integrationFeedCreation.ts
    // survive the disconnect, permanently fail their next sync, and keep
    // occupying a Free-plan source slot the user can't otherwise free.
    mockFeedsReturning.mockResolvedValue([{ id: 10 }, { id: 11 }]);
    const event = {
      context: { user: { id: 7 } },
      params: { provider: "youtube" },
    };

    await handler(event);

    expect(mockFeedsWhere).toHaveBeenCalledWith(
      and(eq(feeds.userId, 7), eq(feeds.source, "youtube")),
    );
  });

  it("reconciles paused sources for the user after deleting dependent feeds frees a slot", async () => {
    mockFeedsReturning.mockResolvedValue([{ id: 10 }]);
    const event = {
      context: { user: { id: 7 } },
      params: { provider: "bluesky" },
    };

    await handler(event);

    expect(mockReconcile).toHaveBeenCalledWith(7);
  });

  it("does not reconcile when there were no dependent feeds to delete", async () => {
    mockFeedsReturning.mockResolvedValue([]);
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };

    await handler(event);

    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("still returns ok when reconciling paused feeds fails after a committed disconnect", async () => {
    mockFeedsReturning.mockResolvedValue([{ id: 10 }]);
    mockReconcile.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = {
      context: { user: { id: 1 } },
      params: { provider: "youtube" },
    };

    const result = await handler(event);

    expect(result).toEqual({ ok: true, revoked: true });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to reconcile paused feeds after disconnecting youtube:",
      expect.any(Error),
    );
  });
});
