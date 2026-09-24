import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
import SettingsConnections from "~/components/SettingsConnections.vue";
import { makeConnection } from "../fixtures";

const connected = makeConnection({
  id: "youtube",
  name: "YouTube",
  connected: true,
  account: "@mychannel",
  since: "Connected Jan 2024",
});
const disconnected = makeConnection({
  id: "bluesky",
  name: "Bluesky",
  connected: false,
  color: "var(--src-tweet)",
});
const needsReconnect = makeConnection({
  id: "youtube",
  name: "YouTube",
  connected: true,
  account: "@mychannel",
  since: "Connected Jan 2024",
  needsReconnect: true,
  syncError: "YouTube access token expired. Re-connect your YouTube account.",
});

const mockConnect = vi.fn();
const mockReconnect = vi.fn();
const mockConnectBluesky = vi.fn();
const mockDisconnect = vi.fn();
const mockLoad = vi.fn();

function stubConnections(
  connections = [connected, disconnected],
  opts: { loading?: boolean; error?: string | null } = {},
) {
  vi.stubGlobal("useConnections", () => ({
    items: ref(connections),
    loading: ref(opts.loading ?? false),
    error: ref(opts.error ?? null),
    load: mockLoad,
    connect: mockConnect,
    reconnect: mockReconnect,
    connectBluesky: mockConnectBluesky,
    disconnect: mockDisconnect,
  }));
}

describe("SettingsConnections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubConnections();
  });

  it("renders a card for each connection", () => {
    const wrapper = shallowMount(SettingsConnections);
    expect(wrapper.findAll(".conn")).toHaveLength(2);
  });

  it("shows Disconnect for connected accounts", () => {
    const wrapper = shallowMount(SettingsConnections);
    const buttons = wrapper.findAll("button.btn");
    expect(buttons[0].text()).toBe("Disconnect");
  });

  it("shows Connect for disconnected accounts", () => {
    const wrapper = shallowMount(SettingsConnections);
    const buttons = wrapper.findAll("button.btn");
    expect(buttons[1].text()).toBe("Connect");
  });

  it("calls disconnect when button is clicked for a connected account", async () => {
    const wrapper = shallowMount(SettingsConnections);
    await wrapper.findAll("button.btn")[0].trigger("click");
    expect(mockDisconnect).toHaveBeenCalledWith(connected.id);
  });

  it("shows the Bluesky form when Connect is clicked for bluesky", async () => {
    const wrapper = shallowMount(SettingsConnections);
    await wrapper.findAll("button.btn")[1].trigger("click");
    expect(wrapper.find(".bluesky-form").exists()).toBe(true);
  });

  it("shows a live dot for connected accounts", () => {
    const wrapper = shallowMount(SettingsConnections);
    expect(wrapper.find(".live").exists()).toBe(true);
  });

  it("shows an error message when error is set", () => {
    stubConnections(undefined, { error: "Failed to load connections" });
    const wrapper = shallowMount(SettingsConnections);
    expect(wrapper.find(".conn-error").exists()).toBe(true);
    expect(wrapper.find(".conn-error").text()).toContain("Failed to load");
  });

  it("disables buttons when loading", () => {
    stubConnections(undefined, { loading: true });
    const wrapper = shallowMount(SettingsConnections);
    const buttons = wrapper.findAll("button.btn");
    buttons.forEach((button) =>
      expect(button.attributes("disabled")).toBeDefined(),
    );
  });

  it("hides the bluesky form by default", () => {
    const wrapper = shallowMount(SettingsConnections);
    expect(wrapper.find(".bluesky-form").exists()).toBe(false);
  });

  it("hides the bluesky form after cancel is clicked", async () => {
    const wrapper = shallowMount(SettingsConnections);
    await wrapper.findAll("button.btn")[1].trigger("click");
    expect(wrapper.find(".bluesky-form").exists()).toBe(true);
    const formButtons = wrapper.findAll(".bluesky-actions button");
    const cancelButton = formButtons.find((btn) => btn.text() === "Cancel");
    await cancelButton!.trigger("click");
    expect(wrapper.find(".bluesky-form").exists()).toBe(false);
  });

  it("calls connectBluesky with handle and app password on form submit", async () => {
    mockConnectBluesky.mockResolvedValue({
      ok: true,
      handle: "you.bsky.social",
    });
    // Use a local stub that renders a real input so setValue works
    const inputStub = {
      props: ["modelValue", "id", "label", "type", "placeholder", "disabled"],
      emits: ["update:modelValue"],
      template:
        '<input :id="id" :type="type ?? \'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    };
    const wrapper = shallowMount(SettingsConnections, {
      global: { stubs: { InputText: inputStub } },
    });
    await wrapper.findAll("button.btn")[1].trigger("click");
    await wrapper.find("#bluesky-handle").setValue("you.bsky.social");
    await wrapper.find("#bluesky-app-password").setValue("xxxx-xxxx-xxxx-xxxx");
    const connectButton = wrapper
      .findAll(".bluesky-actions button")
      .find((btn) => btn.text() === "Connect");
    await connectButton!.trigger("click");
    expect(mockConnectBluesky).toHaveBeenCalledWith(
      "you.bsky.social",
      "xxxx-xxxx-xxxx-xxxx",
    );
  });

  it("matches snapshot", () => {
    const wrapper = shallowMount(SettingsConnections);
    expect(wrapper.html()).toMatchSnapshot();
  });

  describe("needs-reconnect indicator", () => {
    it("shows a needs-reconnect badge for a connection with a sync error", () => {
      stubConnections([needsReconnect, disconnected]);
      const wrapper = shallowMount(SettingsConnections);
      expect(wrapper.findAll(".feed-stat.error")).toHaveLength(1);
    });

    it("does not show a needs-reconnect badge for a healthy connection", () => {
      stubConnections([connected, disconnected]);
      const wrapper = shallowMount(SettingsConnections);
      expect(wrapper.find(".feed-stat.error").exists()).toBe(false);
    });

    it("surfaces the sync error message as the badge title", () => {
      stubConnections([needsReconnect]);
      const wrapper = shallowMount(SettingsConnections);
      expect(wrapper.find(".feed-stat.error").attributes("title")).toBe(
        needsReconnect.syncError,
      );
    });

    it("matches snapshot with a connection needing reconnect", () => {
      stubConnections([needsReconnect, disconnected]);
      const wrapper = shallowMount(SettingsConnections);
      expect(wrapper.html()).toMatchSnapshot();
    });

    it("offers both Reconnect and Disconnect for a needs-reconnect connection", () => {
      stubConnections([needsReconnect]);
      const wrapper = shallowMount(SettingsConnections);
      const labels = wrapper.findAll("button.btn").map((btn) => btn.text());
      expect(labels).toEqual(["Reconnect", "Disconnect"]);
    });

    it("does not offer Reconnect for a healthy connected account", () => {
      stubConnections([connected]);
      const wrapper = shallowMount(SettingsConnections);
      const labels = wrapper.findAll("button.btn").map((btn) => btn.text());
      expect(labels).toEqual(["Disconnect"]);
    });

    it("re-runs the OAuth connect flow when Reconnect is clicked", async () => {
      stubConnections([needsReconnect]);
      const wrapper = shallowMount(SettingsConnections);
      const reconnectButton = wrapper
        .findAll("button.btn")
        .find((btn) => btn.text() === "Reconnect");
      await reconnectButton!.trigger("click");
      expect(mockReconnect).toHaveBeenCalledWith(needsReconnect.id);
      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it("still allows Disconnect for a needs-reconnect connection", async () => {
      stubConnections([needsReconnect]);
      const wrapper = shallowMount(SettingsConnections);
      const disconnectButton = wrapper
        .findAll("button.btn")
        .find((btn) => btn.text() === "Disconnect");
      await disconnectButton!.trigger("click");
      expect(mockDisconnect).toHaveBeenCalledWith(needsReconnect.id);
      expect(mockReconnect).not.toHaveBeenCalled();
    });

    it("re-opens the Bluesky form when reconnecting a needs-reconnect Bluesky account", async () => {
      const needsReconnectBluesky = makeConnection({
        id: "bluesky",
        name: "Bluesky",
        connected: true,
        needsReconnect: true,
        syncError: "Bluesky session expired.",
      });
      stubConnections([needsReconnectBluesky]);
      const wrapper = shallowMount(SettingsConnections);
      const reconnectButton = wrapper
        .findAll("button.btn")
        .find((btn) => btn.text() === "Reconnect");
      await reconnectButton!.trigger("click");
      expect(wrapper.find(".bluesky-form").exists()).toBe(true);
      expect(mockReconnect).not.toHaveBeenCalled();
    });
  });
});
