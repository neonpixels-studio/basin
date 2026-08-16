import { describe, it, expect, beforeEach, vi } from "vitest";

// clerkMiddleware runs Clerk auth then calls our handler — stub it as a pass-through
// so we can test our handler in isolation with a pre-populated event.context.auth.
vi.mock("@clerk/nuxt/server", () => ({
  clerkMiddleware: (handler: Function) => handler,
}));

const mockGetOrCreateUser = vi.fn();
vi.stubGlobal("getOrCreateUser", mockGetOrCreateUser);

import serverAuthMiddleware from "../../../server/middleware/auth";

const mockUser = {
  id: 1,
  providerId: "clerk_abc",
  createdAt: null,
  updatedAt: null,
};

describe("server/middleware/auth", () => {
  function makeEvent(userId: string | null = null) {
    return { context: { auth: () => ({ userId }) } };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips getOrCreateUser when there is no authenticated userId", async () => {
    const event = makeEvent(null);
    await serverAuthMiddleware(event as any);
    expect(mockGetOrCreateUser).not.toHaveBeenCalled();
    expect(event.context).not.toHaveProperty("user");
  });

  it("attaches the DB user to event context for authenticated requests", async () => {
    mockGetOrCreateUser.mockResolvedValue(mockUser);
    const event = makeEvent("clerk_abc");
    await serverAuthMiddleware(event as any);
    expect(mockGetOrCreateUser).toHaveBeenCalledWith("clerk_abc");
    expect((event.context as any).user).toEqual(mockUser);
  });

  // getOrCreateUser throws a 403 for a tombstoned (deleted) identity; the
  // middleware must surface that rather than swallowing it into an
  // unauthenticated request. End-to-end tombstone behavior is covered in
  // tests/server/utils/auth.test.ts.
  it("propagates an auth error from getOrCreateUser and attaches no user", async () => {
    mockGetOrCreateUser.mockRejectedValue({ statusCode: 403 });
    const event = makeEvent("clerk_deleted");
    await expect(serverAuthMiddleware(event as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(event.context).not.toHaveProperty("user");
  });
});
