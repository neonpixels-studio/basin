import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";

const mockIsSignedIn = ref(false);
const mockNavigateTo = vi.fn();

vi.stubGlobal("useAuth", () => ({ isSignedIn: mockIsSignedIn }));
vi.stubGlobal("navigateTo", mockNavigateTo);

import authMiddleware from "~/middleware/auth.global";

describe("auth.global middleware", () => {
  beforeEach(() => {
    mockIsSignedIn.value = false;
    mockNavigateTo.mockClear();
  });

  it("does not redirect unauthenticated user on / (public)", () => {
    authMiddleware({ path: "/" } as any);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("does not redirect unauthenticated user on /pricing (public)", () => {
    authMiddleware({ path: "/pricing" } as any);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it.each(["/about", "/privacy", "/contact"])(
    "does not redirect unauthenticated user on %s (public)",
    (path) => {
      authMiddleware({ path } as any);
      expect(mockNavigateTo).not.toHaveBeenCalled();
    },
  );

  it("does not redirect unauthenticated user on /pricing/ (trailing slash)", () => {
    authMiddleware({ path: "/pricing/" } as any);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated user on protected routes to /login", () => {
    authMiddleware({ path: "/dashboard" } as any);
    expect(mockNavigateTo).toHaveBeenCalledWith("/login");
  });

  it("does not redirect unauthenticated user already on /login", () => {
    authMiddleware({ path: "/login" } as any);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("redirects signed-in user from / to /dashboard", () => {
    mockIsSignedIn.value = true;
    authMiddleware({ path: "/" } as any);
    expect(mockNavigateTo).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects signed-in user from /login to /dashboard", () => {
    mockIsSignedIn.value = true;
    authMiddleware({ path: "/login" } as any);
    expect(mockNavigateTo).toHaveBeenCalledWith("/dashboard");
  });

  it("does not redirect signed-in user on other routes", () => {
    mockIsSignedIn.value = true;
    authMiddleware({ path: "/settings" } as any);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });
});
