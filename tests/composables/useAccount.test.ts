import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAccount } from "~/composables/useAccount";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const mockGetToken = vi.fn().mockResolvedValue("token-123");
vi.stubGlobal("useAuth", () => ({ getToken: { value: mockGetToken } }));

describe("useAccount", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetToken.mockResolvedValue("token-123");
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
});
