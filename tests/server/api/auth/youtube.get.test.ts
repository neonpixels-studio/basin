import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetCookie = vi.fn();
const mockGetRequestURL = vi.fn();
const mockSendRedirect = vi.fn();
const mockBuildYouTubeAuthUrl = vi.fn(
  () => "https://accounts.google.com/oauth?test=1",
);
const CONFIGURED_CALLBACK_URL =
  "https://basin.example.com/api/auth/youtube/callback";
const mockBuildYouTubeCallbackUrl = vi.fn(() => CONFIGURED_CALLBACK_URL);

vi.stubGlobal("setCookie", mockSetCookie);
vi.stubGlobal("getRequestURL", mockGetRequestURL);
vi.stubGlobal("sendRedirect", mockSendRedirect);
vi.stubGlobal("buildYouTubeAuthUrl", mockBuildYouTubeAuthUrl);
vi.stubGlobal("buildYouTubeCallbackUrl", mockBuildYouTubeCallbackUrl);

import handler from "../../../../server/api/auth/youtube.get";

describe("GET /api/auth/youtube", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetRequestURL.mockReturnValue(
      new URL("https://attacker.example.com/api/auth/youtube"),
    );
    mockSendRedirect.mockResolvedValue(undefined);
    mockBuildYouTubeAuthUrl.mockReturnValue(
      "https://accounts.google.com/oauth?test=1",
    );
    mockBuildYouTubeCallbackUrl.mockReturnValue(CONFIGURED_CALLBACK_URL);
  });

  it("throws 401 when not authenticated", async () => {
    const event = { context: { user: null } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("sets the oauth_state_youtube cookie as httpOnly with lax sameSite", async () => {
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockSetCookie).toHaveBeenCalledWith(
      event,
      "oauth_state_youtube",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    );
  });

  it("sets the oauth_state_youtube cookie with a 600s TTL", async () => {
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockSetCookie).toHaveBeenCalledWith(
      event,
      "oauth_state_youtube",
      expect.any(String),
      expect.objectContaining({ maxAge: 600 }),
    );
  });

  it("redirects to the URL returned by buildYouTubeAuthUrl", async () => {
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockSendRedirect).toHaveBeenCalledWith(
      event,
      "https://accounts.google.com/oauth?test=1",
    );
  });

  it("builds redirect_uri from the configured site URL, not the request origin", async () => {
    // The request arrives on a forged host; the redirect_uri must still be the
    // server-configured callback so a spoofed Host header can't hijack the flow.
    mockGetRequestURL.mockReturnValue(
      new URL("https://attacker.example.com/api/auth/youtube"),
    );
    const event = { context: { user: { id: 1 } } };
    await handler(event);
    expect(mockBuildYouTubeAuthUrl).toHaveBeenCalledWith(
      CONFIGURED_CALLBACK_URL,
      expect.any(String),
    );
    // Fails loudly if request-origin derivation is ever reintroduced.
    expect(mockGetRequestURL).not.toHaveBeenCalled();
  });

  it("propagates the 500 when the site URL is unconfigured, without redirecting or planting a cookie", async () => {
    mockBuildYouTubeCallbackUrl.mockImplementation(() => {
      throw Object.assign(new Error("Server configuration error"), {
        statusCode: 500,
      });
    });
    const event = { context: { user: { id: 1 } } };
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 500 });
    expect(mockSetCookie).not.toHaveBeenCalled();
    expect(mockBuildYouTubeAuthUrl).not.toHaveBeenCalled();
    expect(mockSendRedirect).not.toHaveBeenCalled();
  });
});
