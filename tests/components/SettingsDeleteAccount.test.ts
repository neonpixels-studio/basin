import { describe, it, expect, vi, beforeEach } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import SettingsDeleteAccount from "~/components/SettingsDeleteAccount.vue";

const ACCOUNT_EMAIL = "demo@example.com";

// A real <input> stub for InputText so v-model / setValue works, mirroring the
// pattern in DashboardOnboarding.test.ts.
const inputStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

function mountComponent() {
  return shallowMount(SettingsDeleteAccount, {
    global: { stubs: { InputText: inputStub } },
  });
}

function stubAccount(deleteAccount = vi.fn().mockResolvedValue(true)) {
  vi.stubGlobal("useAccount", () => ({
    deleting: ref(false),
    error: ref(null),
    deleteAccount,
  }));
  return deleteAccount;
}

async function openAndConfirmEmail(wrapper) {
  await wrapper.find(".btn-danger").trigger("click");
  await wrapper.find("input").setValue(ACCOUNT_EMAIL);
}

describe("SettingsDeleteAccount", () => {
  beforeEach(() => {
    stubAccount();
    vi.stubGlobal("useClerk", () => ref({ signOut: vi.fn() }));
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
    });
  });

  it("shows a confirmation step before deleting", async () => {
    const deleteAccount = stubAccount();
    const wrapper = mountComponent();
    await wrapper.find(".btn-danger").trigger("click");
    expect(wrapper.find(".delete-confirm").exists()).toBe(true);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("keeps the confirm button disabled until the email matches", async () => {
    const deleteAccount = stubAccount();
    const wrapper = mountComponent();
    await wrapper.find(".btn-danger").trigger("click");
    const confirmButton = wrapper.find(".delete-actions .btn-danger");
    expect(confirmButton.attributes("disabled")).toBeDefined();

    await wrapper.find("input").setValue("wrong@example.com");
    expect(confirmButton.attributes("disabled")).toBeDefined();

    await wrapper.find("input").setValue(ACCOUNT_EMAIL);
    expect(confirmButton.attributes("disabled")).toBeUndefined();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the account then signs the user out on confirm", async () => {
    const deleteAccount = stubAccount(vi.fn().mockResolvedValue(true));
    const signOut = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("useClerk", () => ref({ signOut }));
    const wrapper = mountComponent();
    await openAndConfirmEmail(wrapper);
    await wrapper.find(".delete-actions .btn-danger").trigger("click");
    await flushPromises();
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/login" });
    expect(window.location.href).toBe("/login");
  });

  it("does not sign out when deletion fails", async () => {
    stubAccount(vi.fn().mockResolvedValue(false));
    const signOut = vi.fn();
    vi.stubGlobal("useClerk", () => ref({ signOut }));
    const wrapper = mountComponent();
    await openAndConfirmEmail(wrapper);
    await wrapper.find(".delete-actions .btn-danger").trigger("click");
    await flushPromises();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("redirects to /login even if Clerk sign-out rejects", async () => {
    stubAccount(vi.fn().mockResolvedValue(true));
    const signOut = vi.fn().mockRejectedValue(new Error("clerk down"));
    vi.stubGlobal("useClerk", () => ref({ signOut }));
    const wrapper = mountComponent();
    await openAndConfirmEmail(wrapper);
    await wrapper.find(".delete-actions .btn-danger").trigger("click");
    await flushPromises();
    expect(window.location.href).toBe("/login");
  });

  it("cancel closes the confirmation without deleting", async () => {
    const deleteAccount = stubAccount();
    const wrapper = mountComponent();
    await wrapper.find(".btn-danger").trigger("click");
    const cancelButton = wrapper
      .findAll(".delete-actions button")
      .find((button) => button.text() === "Cancel");
    await cancelButton?.trigger("click");
    expect(wrapper.find(".delete-confirm").exists()).toBe(false);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
