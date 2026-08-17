import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useAccount } from "~/composables/useAccount";

const mockFetch = vi.fn();
const mockGetToken = vi.fn();

// Mirrors the real $fetch failure: Nitro's createError({ data }) serializes as
// { ...error, data }, so the FetchError nests our payload at `error.data.data`.
const reverificationError = () =>
  Object.assign(new Error("reverify"), {
    statusCode: 403,
    data: {
      statusCode: 403,
      statusMessage: "Reverification required",
      data: { code: "reverification_required" },
    },
  });

// Stubs the Clerk instance so the reverification modal either verifies or is
// cancelled, then returns the openReverification spy for assertions.
function stubClerkReverification(outcome: "verify" | "cancel") {
  const openReverification = vi.fn((props) => {
    if (outcome === "verify") {
      props.afterVerification();
      return;
    }
    props.afterVerificationCancelled();
  });
  vi.stubGlobal("useClerk", () =>
    ref({ __internal_openReverification: openReverification }),
  );
  return openReverification;
}

describe("useAccount", () => {
  // Re-establish the base stubs each test (and clear any per-test useClerk
  // stub) so a reverification test can't leak its Clerk instance into others.
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue("token-123");
    vi.stubGlobal("$fetch", mockFetch);
    vi.stubGlobal("useAuth", () => ({ getToken: { value: mockGetToken } }));
  });

  it("sends a DELETE to /api/account with the Clerk bearer token", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { deleteAccount } = useAccount();
    const result = await deleteAccount();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/account",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer token-123" },
      }),
    );
  });

  it("returns false and sets an error when the request fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("boom"));
    const { deleteAccount, error } = useAccount();
    const result = await deleteAccount();
    expect(result).toBe(false);
    expect(error.value).toMatch(/Failed to delete/);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("shows a rate-limit message on a 429", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(
      Object.assign(new Error("rate"), { statusCode: 429 }),
    );
    const { deleteAccount, error } = useAccount();
    const result = await deleteAccount();
    expect(result).toBe(false);
    expect(error.value).toMatch(/wait a minute/i);
  });

  it("omits the Authorization header when no token is available", async () => {
    mockGetToken.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: true });
    const { deleteAccount } = useAccount();
    await deleteAccount();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/account",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("prompts reverification and retries when the server requires it", async () => {
    const openReverification = stubClerkReverification("verify");
    mockGetToken
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");
    mockFetch
      .mockRejectedValueOnce(reverificationError())
      .mockResolvedValueOnce({ ok: true });

    const { deleteAccount } = useAccount();
    const result = await deleteAccount();

    expect(result).toBe(true);
    expect(openReverification).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // The retry rebuilds the header, so it carries the freshly reverified token.
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/account",
      expect.objectContaining({
        headers: { Authorization: "Bearer fresh-token" },
      }),
    );
    // skipCache forces a fresh mint so the retry can't reuse Clerk's cached JWT
    // with the stale fva — without it the gate would keep rejecting.
    expect(mockGetToken).toHaveBeenLastCalledWith({ skipCache: true });
  });

  it("does not delete and reports cancellation when the user backs out", async () => {
    stubClerkReverification("cancel");
    mockFetch.mockRejectedValue(reverificationError());

    const { deleteAccount, error } = useAccount();
    const result = await deleteAccount();

    expect(result).toBe(false);
    expect(error.value).toMatch(/cancelled/i);
    // Only the first attempt fired; no retry after cancellation.
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("surfaces a failure without looping when the retry still lacks a fresh session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const openReverification = stubClerkReverification("verify");
    // The gate keeps rejecting (e.g. token never refreshed): prompt once, retry
    // once, then surface the failure rather than reprompting indefinitely.
    mockFetch.mockRejectedValue(reverificationError());

    const { deleteAccount, error } = useAccount();
    const result = await deleteAccount();

    expect(result).toBe(false);
    expect(error.value).toMatch(/Failed to delete/);
    expect(openReverification).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
