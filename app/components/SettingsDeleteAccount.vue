<script setup>
const clerk = useClerk();
const { user } = useUser();
const { deleting, error, deleteAccount } = useAccount();

const confirming = ref(false);
const typedEmail = ref("");
// `deleting` only covers the DELETE request; it clears before the subsequent
// sign-out + redirect settle. `finishing` holds the busy state across that tail
// so the confirm button can't be double-submitted into a second (rate-limited,
// already-deleted) request while we navigate away.
const finishing = ref(false);

const busy = computed(() => deleting.value || finishing.value);

const accountEmail = computed(
  () => user.value?.primaryEmailAddress?.emailAddress ?? "",
);

// Require the user to type their own email before the destructive button is
// enabled, so an unattended session can't be wiped with two stray clicks.
const canConfirm = computed(
  () =>
    !busy.value &&
    typedEmail.value.trim().toLowerCase() ===
      accountEmail.value.toLowerCase() &&
    accountEmail.value.length > 0,
);

function start() {
  confirming.value = true;
  error.value = null;
}

function cancel() {
  confirming.value = false;
  typedEmail.value = "";
  error.value = null;
}

async function signOutAndRedirect() {
  // Belt-and-suspenders: await Clerk's sign-out, but always land on /login even
  // if the Clerk instance isn't ready or the sign-out rejects — the account is
  // already gone, so the user must not be stranded on a dead settings page.
  if (!clerk.value) {
    console.error(
      "Clerk not loaded at sign-out; redirecting to /login anyway.",
    );
  }
  try {
    await clerk.value?.signOut({ redirectUrl: "/login" });
  } catch (signOutError) {
    console.error("Sign-out after account deletion failed:", signOutError);
  } finally {
    // Clear any local session so the redirect can't carry a still-valid token
    // that would re-run getOrCreateUser and resurrect an empty users row.
    try {
      await clerk.value?.session?.remove();
    } catch (removeError) {
      console.error("Could not clear the local Clerk session:", removeError);
    }
    window.location.href = "/login";
  }
}

async function confirm() {
  const deleted = await deleteAccount();
  if (!deleted) {
    return;
  }
  finishing.value = true;
  await signOutAndRedirect();
}
</script>

<template>
  <section class="set-section">
    <h2>Delete account</h2>
    <p class="desc">
      Permanently delete your account and all associated data — feeds, saved
      items, connected accounts, and billing. This cannot be undone.
    </p>

    <button v-if="!confirming" class="btn btn-danger" @click="start">
      <RIcon name="trash" :size="16" /> Delete account
    </button>

    <div v-else class="delete-confirm">
      <p class="delete-warn">
        This will erase everything and sign you out. Type
        <strong>{{ accountEmail }}</strong> to confirm.
      </p>
      <InputText
        v-model="typedEmail"
        placeholder="Enter your email to confirm"
        :disabled="busy"
      />
      <p v-if="error" class="delete-error">{{ error }}</p>
      <div class="delete-actions">
        <button class="btn btn-danger" :disabled="!canConfirm" @click="confirm">
          {{ busy ? "Deleting…" : "Yes, delete everything" }}
        </button>
        <button class="btn" :disabled="busy" @click="cancel">Cancel</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.btn-danger {
  border-color: var(--danger);
  color: var(--danger);
}

.delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  background: color-mix(in oklab, var(--danger) 8%, var(--surface));
}

.delete-warn {
  margin: 0;
  font-weight: 600;
}

.delete-error {
  margin: 0;
  color: var(--danger);
}

.delete-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
