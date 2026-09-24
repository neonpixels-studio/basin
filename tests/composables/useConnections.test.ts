import { describe, it, expect, vi, beforeEach } from "vitest";
import { useConnections } from "~/composables/useConnections";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

const mockShowToast = vi.fn();
vi.stubGlobal("useToast", () => ({ showToast: mockShowToast }));

// Replace window.location so href assignments are observable
const mockLocation = { href: "" };
vi.stubGlobal("location", mockLocation);

const mockIntegration = {
  id: 1,
  provider: "youtube",
  providerUsername: "@mychannel",
  createdAt: new Date("2024-01-01").toISOString(),
};

const mockBlueskyIntegration = {
  id: 2,
  provider: "bluesky",
  providerUsername: "you.bsky.social",
  createdAt: new Date("2024-01-01").toISOString(),
};

describe("useConnections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLocation.href = "";
  });

  describe("load()", () => {
    it("marks the matching provider as connected", async () => {
      mockFetch.mockResolvedValue([mockIntegration]);
      const { items, load } = useConnections();
      await load();
      const youtube = items.value.find(
        (connection) => connection.id === "youtube",
      );
      expect(youtube?.connected).toBe(true);
    });

    it("populates account and since from the DB row", async () => {
      mockFetch.mockResolvedValue([mockIntegration]);
      const { items, load } = useConnections();
      await load();
      const youtube = items.value.find(
        (connection) => connection.id === "youtube",
      );
      expect(youtube?.account).toBe("@mychannel");
      expect(youtube?.since).toMatch(/Connected/);
    });

    it("leaves providers disconnected when absent from the API response", async () => {
      mockFetch.mockResolvedValue([]);
      const { items, load } = useConnections();
      await load();
      expect(items.value.every((connection) => !connection.connected)).toBe(
        true,
      );
    });

    it("sets error on fetch failure and leaves items unchanged", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const { error, load } = useConnections();
      await load();
      expect(error.value).toBeTruthy();
    });

    it("clears a previous error on a successful re-load", async () => {
      const { error, load } = useConnections();
      mockFetch.mockRejectedValueOnce(new Error("oops"));
      await load();
      mockFetch.mockResolvedValueOnce([]);
      await load();
      expect(error.value).toBeNull();
    });

    it("marks needsReconnect when the integration's syncStatus is error", async () => {
      mockFetch.mockResolvedValue([
        { ...mockIntegration, syncStatus: "error", syncError: "Token expired" },
      ]);
      const { items, load } = useConnections();
      await load();
      const youtube = items.value.find(
        (connection) => connection.id === "youtube",
      );
      expect(youtube?.needsReconnect).toBe(true);
      expect(youtube?.syncError).toBe("Token expired");
    });

    it("leaves needsReconnect false when the integration's syncStatus is ok", async () => {
      mockFetch.mockResolvedValue([
        { ...mockIntegration, syncStatus: "ok", syncError: null },
      ]);
      const { items, load } = useConnections();
      await load();
      const youtube = items.value.find(
        (connection) => connection.id === "youtube",
      );
      expect(youtube?.needsReconnect).toBe(false);
      expect(youtube?.syncError).toBeNull();
    });

    it("leaves needsReconnect false for a disconnected provider", async () => {
      mockFetch.mockResolvedValue([]);
      const { items, load } = useConnections();
      await load();
      expect(
        items.value.every((connection) => !connection.needsReconnect),
      ).toBe(true);
    });
  });

  describe("connect()", () => {
    it("navigates to /api/auth/youtube for the YouTube provider", () => {
      const { connect } = useConnections();
      connect("youtube");
      expect(mockLocation.href).toBe("/api/auth/youtube");
    });

    it("shows a toast for unknown providers instead of navigating", () => {
      const { connect } = useConnections();
      connect("twitter");
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("twitter"),
      );
      expect(mockLocation.href).toBe("");
    });

    it("does not navigate or show a toast for bluesky (form-based flow)", () => {
      const { connect } = useConnections();
      connect("bluesky");
      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockLocation.href).toBe("");
    });
  });

  describe("reconnect()", () => {
    it("re-runs the OAuth flow for a needs-reconnect YouTube integration", () => {
      const { reconnect } = useConnections();
      reconnect("youtube");
      expect(mockLocation.href).toBe("/api/auth/youtube");
    });

    it("shows a toast for an unsupported needs-reconnect provider instead of navigating", () => {
      const { reconnect } = useConnections();
      reconnect("twitter");
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining("twitter"),
      );
      expect(mockLocation.href).toBe("");
    });

    it("does not navigate or show a toast for a needs-reconnect Bluesky integration (form-based flow)", () => {
      const { reconnect } = useConnections();
      reconnect("bluesky");
      expect(mockShowToast).not.toHaveBeenCalled();
      expect(mockLocation.href).toBe("");
    });
  });

  describe("normalizeBlueskyHandle()", () => {
    async function postedHandle(handle: string): Promise<string> {
      mockFetch.mockResolvedValueOnce({ ok: true, handle });
      mockFetch.mockResolvedValueOnce([]);
      const { connectBluesky } = useConnections();
      await connectBluesky(handle, "xxxx-xxxx-xxxx-xxxx");
      return mockFetch.mock.calls[0][1].body.handle;
    }

    it("appends .bsky.social when given a bare handle", async () => {
      expect(await postedHandle("grimicorn")).toBe("grimicorn.bsky.social");
    });

    it("strips leading @ and appends .bsky.social", async () => {
      expect(await postedHandle("@grimicorn")).toBe("grimicorn.bsky.social");
    });

    it("passes through a fully qualified handle unchanged", async () => {
      expect(await postedHandle("grimicorn.bsky.social")).toBe(
        "grimicorn.bsky.social",
      );
    });

    it("strips leading @ from a fully qualified handle", async () => {
      expect(await postedHandle("@grimicorn.bsky.social")).toBe(
        "grimicorn.bsky.social",
      );
    });
  });

  describe("connectBluesky()", () => {
    it("throws and sets error when handle normalizes to an empty string", async () => {
      const { connectBluesky, error } = useConnections();
      await expect(connectBluesky("@", "xxxx-xxxx-xxxx-xxxx")).rejects.toThrow(
        "Bluesky handle is required",
      );
      expect(error.value).toBe("Bluesky handle is required");
    });

    it("posts to /api/auth/bluesky and reloads connections on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, handle: "you.bsky.social" });
      mockFetch.mockResolvedValueOnce([mockBlueskyIntegration]);
      const { connectBluesky, items } = useConnections();
      await connectBluesky("you.bsky.social", "xxxx-xxxx-xxxx-xxxx");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/auth/bluesky",
        expect.objectContaining({ method: "POST" }),
      );
      const bluesky = items.value.find(
        (connection) => connection.id === "bluesky",
      );
      expect(bluesky?.connected).toBe(true);
    });

    it("sets error when the request fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const { connectBluesky, error } = useConnections();
      await expect(
        connectBluesky("you.bsky.social", "xxxx-xxxx-xxxx-xxxx"),
      ).rejects.toBeTruthy();
      expect(error.value).toBeTruthy();
    });
  });

  describe("disconnect()", () => {
    it("optimistically clears the connected state", async () => {
      mockFetch.mockResolvedValueOnce([mockIntegration]);
      mockFetch.mockResolvedValueOnce(undefined);
      const { items, load, disconnect } = useConnections();
      await load();
      await disconnect("youtube");
      const youtube = items.value.find(
        (connection) => connection.id === "youtube",
      );
      expect(youtube?.connected).toBe(false);
      expect(youtube?.account).toBe("");
      expect(youtube?.since).toBe("");
    });

    it("sends DELETE to /api/integrations/:provider", async () => {
      mockFetch.mockResolvedValueOnce([mockIntegration]);
      mockFetch.mockResolvedValueOnce(undefined);
      const { load, disconnect } = useConnections();
      await load();
      await disconnect("youtube");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/integrations/youtube",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("restores previous state and sets error when DELETE fails", async () => {
      mockFetch.mockResolvedValueOnce([mockIntegration]);
      mockFetch.mockRejectedValueOnce(new Error("Server error"));
      const { items, error, load, disconnect } = useConnections();
      await load();
      await disconnect("youtube");
      const youtube = items.value.find(
        (connection) => connection.id === "youtube",
      );
      expect(youtube?.connected).toBe(true);
      expect(error.value).toBeTruthy();
    });

    it("does nothing when the provider is not in the list", async () => {
      mockFetch.mockResolvedValue([]);
      const { load, disconnect } = useConnections();
      await load();
      await disconnect("unknown-provider");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
