<script setup>
const clerk = useClerk();
const { user } = useUser();
const { deleting, error, deleteAccount } = useAccount();

const confirming = ref(false);
const typedEmail = ref("");

const accountEmail = computed(
  () => user.value?.primaryEmailAddress?.emailAddress ?? "",
);

// Require the user to type their own email before the destructive button is
// enabled, so an unattended session can't be wiped with two stray clicks.
const canConfirm = computed(
  () =>
    !deleting.value &&
    typedEmail.value.trim().toLowerCase() ===
      accountEmail.value.toLowerCase() &&
    accountEmail.value.length > 0,
);

function start() {
  confirming.value = true;
}

function cancel() {
  confirming.value = false;
  typedEmail.value = "";
}

async function signOutAndRedirect() {
  // Belt-and-suspenders: await Clerk's sign-out, but always land on /login even
  // if the Clerk instance isn't ready or the sign-out rejects — the account is
  // already gone, so the user must not be stranded on a dead settings page.
  try {
    await clerk.value?.signOut({ redirectUrl: "/login" });
  } catch (signOutError) {
    console.error("Sign-out after account deletion failed:", signOutError);
  } finally {
    window.location.href = "/login";
  }
}

async function confirm() {
  const deleted = await deleteAccount();
  if (!deleted) {
    return;
  }
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
        :disabled="deleting"
      />
      <p v-if="error" class="delete-error">{{ error }}</p>
      <div class="delete-actions">
        <button class="btn btn-danger" :disabled="!canConfirm" @click="confirm">
          {{ deleting ? "Deleting…" : "Yes, delete everything" }}
        </button>
        <button class="btn" :disabled="deleting" @click="cancel">Cancel</button>
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
