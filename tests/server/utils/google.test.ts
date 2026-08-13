import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("useRuntimeConfig", () => ({
  googleClientId: "test-client-id",
  googleClientSecret: "test-client-secret",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  buildYouTubeAuthUrl,
  exchangeCodeForTokens,
  getYouTubeChannelHandle,
  revokeGoogleToken,
} from "../../../server/utils/google";

describe("buildYouTubeAuthUrl", () => {
  it("returns a google accounts URL", () => {
    const url = buildYouTubeAuthUrl("https://example.com/callback", "state123");
    expect(url).toContain("accounts.google.com");
  });

  it("includes client_id, redirect_uri, and state", () => {
    const url = buildYouTubeAuthUrl("https://example.com/callback", "state123");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("state=state123");
  });

  it("requests offline access with consent prompt", () => {
    const url = buildYouTubeAuthUrl("https://example.com/callback", "abc");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
  });

  it("includes youtube.readonly and userinfo.profile scopes", () => {
    const url = buildYouTubeAuthUrl("https://example.com/callback", "abc");
    expect(url).toContain("youtube.readonly");
    expect(url).toContain("userinfo.profile");
  });
});

describe("exchangeCodeForTokens", () => {
  beforeEach(() => vi.resetAllMocks());

  it("posts to the Google token endpoint and returns parsed JSON", async () => {
    const tokenData = {
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      token_type: "Bearer",
    };
    mockFetch.mockResolvedValue({ json: () => Promise.resolve(tokenData) });

    const result = await exchangeCodeForTokens(
      "auth-code",
      "https://example.com/callback",
    );
    expect(result).toEqual(tokenData);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends the authorization code and client credentials in the form body", async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({}) });
    await exchangeCodeForTokens("my-code", "https://example.com/cb");
    const body = mockFetch.mock.calls[0][1].body.toString();
    expect(body).toContain("code=my-code");
    expect(body).toContain("client_id=test-client-id");
    expect(body).toContain("client_secret=test-client-secret");
    expect(body).toContain("grant_type=authorization_code");
  });
});

describe("getYouTubeChannelHandle", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the channel customUrl when present", async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          items: [
            { snippet: { customUrl: "@mychannel", title: "My Channel" } },
          ],
        }),
    });
    const handle = await getYouTubeChannelHandle("access-token");
    expect(handle).toBe("@mychannel");
  });

  it("falls back to title when customUrl is absent", async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          items: [{ snippet: { title: "My Channel" } }],
        }),
    });
    const handle = await getYouTubeChannelHandle("access-token");
    expect(handle).toBe("My Channel");
  });

  it("returns an empty string when items is empty", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ items: [] }),
    });
    const handle = await getYouTubeChannelHandle("access-token");
    expect(handle).toBe("");
  });

  it("calls the YouTube channels API with a Bearer token", async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ items: [] }) });
    await getYouTubeChannelHandle("my-token");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("youtube/v3/channels"),
      expect.objectContaining({
        headers: { Authorization: "Bearer my-token" },
      }),
    );
  });
});

describe("revokeGoogleToken", () => {
  beforeEach(() => vi.resetAllMocks());

  it("posts the token to the Google revoke endpoint as form data", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await revokeGoogleToken("refresh-789");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
    const body = mockFetch.mock.calls[0][1].body.toString();
    expect(body).toContain("token=refresh-789");
  });

  it("passes a live (not pre-aborted) timeout signal", async () => {
    // Asserting the exact timeout boundary isn't feasible: AbortSignal.timeout
    // ignores vitest fake timers and the mocked fetch never observes the abort.
    // This still fails if the signal is dropped (undefined) or replaced with an
    // already-aborted signal — the regressions worth catching here.
    mockFetch.mockResolvedValue({ ok: true });
    await revokeGoogleToken("token");
    const { signal } = mockFetch.mock.calls[0][1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("resolves without throwing on a 2xx response", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await expect(revokeGoogleToken("token")).resolves.toBeUndefined();
  });

  it("throws when the revoke endpoint returns a non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });
    await expect(revokeGoogleToken("bad-token")).rejects.toThrow(
      "Google token revocation failed: 400",
    );
  });
});
