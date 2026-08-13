import { describe, it, expect, vi, afterEach } from "vitest";
import { useAuthHeaders } from "~/composables/useAuthHeaders";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubToken(token: string | null) {
  vi.stubGlobal("useAuth", () => ({
    getToken: { value: vi.fn().mockResolvedValue(token) },
  }));
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
});
