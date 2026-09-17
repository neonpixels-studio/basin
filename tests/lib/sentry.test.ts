import { describe, it, expect, vi, beforeEach } from "vitest";

// @sentry/nuxt is mocked once, globally, in tests/setup.ts — every test file
// (this one included) transitively loads app/lib/sentry.ts via the eager
// `useAppearanceStore` import in that setup file, so a module-scoped mock
// declared here instead would bind to a *different* mock instance than the
// one app/lib/sentry.ts actually calls, and every assertion below would
// silently see zero calls. Reuse the shared scope so `setExtras` assertions
// still work.
import { mockSentryScope as mockScope } from "../setup";

import * as SentrySDK from "@sentry/nuxt";
import {
  captureException,
  captureMessage,
  identifyUser,
  clearUser,
} from "~/lib/sentry";

beforeEach(() => {
  vi.clearAllMocks();
  mockScope.setExtras.mockClear();
});

describe("captureException", () => {
  it("forwards the error to Sentry.captureException", () => {
    const error = new Error("boom");
    captureException(error);

    expect(SentrySDK.captureException).toHaveBeenCalledWith(error);
  });

  it("sets extras on the scope when provided", () => {
    const extras = { requestId: "abc123" };
    captureException(new Error("boom"), extras);

    expect(mockScope.setExtras).toHaveBeenCalledWith(extras);
  });

  it("does not call setExtras when no extras are provided", () => {
    captureException(new Error("no extras"));

    expect(mockScope.setExtras).not.toHaveBeenCalled();
  });
});

describe("captureMessage", () => {
  it("forwards the message to Sentry.captureMessage", () => {
    captureMessage("hello sentry");

    expect(SentrySDK.captureMessage).toHaveBeenCalledWith("hello sentry");
  });

  it("sets extras on the scope when provided", () => {
    const extras = { page: "/dashboard" };
    captureMessage("test message", extras);

    expect(mockScope.setExtras).toHaveBeenCalledWith(extras);
  });
});

describe("identifyUser", () => {
  it("calls Sentry.setUser with the provided user", () => {
    identifyUser({ id: "user_123", email: "test@example.com" });

    expect(SentrySDK.setUser).toHaveBeenCalledWith({
      id: "user_123",
      email: "test@example.com",
    });
  });

  it("works without an email", () => {
    identifyUser({ id: "user_456" });

    expect(SentrySDK.setUser).toHaveBeenCalledWith({ id: "user_456" });
  });
});

describe("clearUser", () => {
  it("calls Sentry.setUser with null", () => {
    clearUser();

    expect(SentrySDK.setUser).toHaveBeenCalledWith(null);
  });
});
