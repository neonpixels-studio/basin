import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeleteUser, mockClerkClient } = vi.hoisted(() => {
  const mockDeleteUser = vi.fn();
  const mockClerkClient = vi.fn(() => ({
    users: { deleteUser: mockDeleteUser },
  }));
  return { mockDeleteUser, mockClerkClient };
});

vi.mock("@clerk/nuxt/server", () => ({ clerkClient: mockClerkClient }));

import { deleteClerkUser } from "../../../server/utils/clerk";

describe("deleteClerkUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the client from the event and deletes the given provider id", async () => {
    const event = { context: {} };
    await deleteClerkUser(event as never, "user_abc");
    expect(mockClerkClient).toHaveBeenCalledWith(event);
    expect(mockDeleteUser).toHaveBeenCalledWith("user_abc");
  });
});
