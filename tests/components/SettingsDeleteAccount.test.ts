import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import SettingsDeleteAccount from "~/components/SettingsDeleteAccount.vue";

function stubAccount(deleteAccount = vi.fn().mockResolvedValue(true)) {
  vi.stubGlobal("useAccount", () => ({
    deleting: ref(false),
    error: ref(null),
    deleteAccount,
  }));
  return deleteAccount;
}

describe("SettingsDeleteAccount", () => {
  beforeEach(() => {
    stubAccount();
    vi.stubGlobal("useClerk", () => ref({ signOut: vi.fn() }));
  });

  it("shows a confirmation step before deleting", async () => {
    const deleteAccount = stubAccount();
    const wrapper = shallowMount(SettingsDeleteAccount);
    await wrapper.find(".btn-danger").trigger("click");
    expect(wrapper.find(".delete-confirm").exists()).toBe(true);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the account then signs the user out on confirm", async () => {
    const deleteAccount = stubAccount(vi.fn().mockResolvedValue(true));
    const signOut = vi.fn();
    vi.stubGlobal("useClerk", () => ref({ signOut }));
    const wrapper = shallowMount(SettingsDeleteAccount);
    await wrapper.find(".btn-danger").trigger("click");
    await wrapper.find(".delete-actions .btn-danger").trigger("click");
    await flushPromises();
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/login" });
  });

  it("does not sign out when deletion fails", async () => {
    stubAccount(vi.fn().mockResolvedValue(false));
    const signOut = vi.fn();
    vi.stubGlobal("useClerk", () => ref({ signOut }));
    const wrapper = shallowMount(SettingsDeleteAccount);
    await wrapper.find(".btn-danger").trigger("click");
    await wrapper.find(".delete-actions .btn-danger").trigger("click");
    await flushPromises();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("cancel closes the confirmation without deleting", async () => {
    const deleteAccount = stubAccount();
    const wrapper = shallowMount(SettingsDeleteAccount);
    await wrapper.find(".btn-danger").trigger("click");
    const cancelButton = wrapper
      .findAll(".delete-actions button")
      .find((button) => button.text() === "Cancel");
    await cancelButton?.trigger("click");
    expect(wrapper.find(".delete-confirm").exists()).toBe(false);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
