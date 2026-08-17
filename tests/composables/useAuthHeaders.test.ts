import { describe, it, expect, vi, afterEach } from "vitest";
import { useAuthHeaders } from "~/composables/useAuthHeaders";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubToken(token: string | null) {
  const getToken = vi.fn().mockResolvedValue(token);
  vi.stubGlobal("useAuth", () => ({ getToken: { value: getToken } }));
  return getToken;
}

describe("useAuthHeaders", () => {
  it("returns a bearer Authorization header when a token is present", async () => {
    stubToken("token-abc");
    const { buildAuthHeaders } = useAuthHeaders();
    expect(await buildAuthHeaders()).toEqual({
      Authorization: "Bearer token-abc",
    });
  });

  it("returns an empty header object when there is no token", async () => {
    stubToken(null);
    const { buildAuthHeaders } = useAuthHeaders();
    expect(await buildAuthHeaders()).toEqual({});
  });

  it("forwards options (e.g. skipCache) to getToken so callers can force a fresh mint", async () => {
    const getToken = stubToken("token-abc");
    const { buildAuthHeaders } = useAuthHeaders();
    await buildAuthHeaders({ skipCache: true });
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
  });
});
