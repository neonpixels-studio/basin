import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetRequestURL = vi.fn();
const mockGetHeader = vi.fn();
vi.stubGlobal("getRequestURL", mockGetRequestURL);
vi.stubGlobal("getHeader", mockGetHeader);

import csrfMiddleware from "../../../server/middleware/csrf";

const TARGET_ORIGIN = "https://basin.test";

function makeEvent(method: string) {
  return { method };
}

function setPath(path: string) {
  mockGetRequestURL.mockReturnValue(new URL(`${TARGET_ORIGIN}${path}`));
}

// Drives getHeader(event, name) off a plain map of header → value.
function setHeaders(headers: Record<string, string>) {
  mockGetHeader.mockImplementation(
    (_event: unknown, name: string) => headers[name],
  );
}

describe("server/middleware/csrf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHeaders({});
  });

  it("allows safe methods without inspecting headers", () => {
    setPath("/api/feeds");
    expect(() => csrfMiddleware(makeEvent("GET") as any)).not.toThrow();
    expect(mockGetHeader).not.toHaveBeenCalled();
  });

  it("ignores non-API paths", () => {
    setPath("/login");
    expect(() => csrfMiddleware(makeEvent("POST") as any)).not.toThrow();
  });

  it("allows a same-origin state-changing request", () => {
    setPath("/api/sync");
    setHeaders({ "sec-fetch-site": "same-origin", origin: TARGET_ORIGIN });
    expect(() => csrfMiddleware(makeEvent("POST") as any)).not.toThrow();
  });

  it("rejects a cross-site state-changing request with a 403", () => {
    setPath("/api/mark-all-read");
    setHeaders({
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
    });
    expect(() => csrfMiddleware(makeEvent("POST") as any)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("rejects a cross-origin request when Sec-Fetch-Site is absent", () => {
    setPath("/api/feeds");
    setHeaders({ origin: "https://evil.example" });
    expect(() => csrfMiddleware(makeEvent("POST") as any)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("exempts the Stripe webhook route (signed, no browser Origin)", () => {
    setPath("/api/billing/webhook");
    setHeaders({ origin: "https://evil.example" });
    expect(() => csrfMiddleware(makeEvent("POST") as any)).not.toThrow();
  });
});
