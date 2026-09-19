<script setup>
import { FREE_ACCOUNT_PLAN } from "~/composables/useBilling";

const feedStore = useFeedStore();
const { user } = useUser();
const clerk = useClerk();
const {
  loadPlan,
  openPortal,
  loading: billingLoading,
  error: billingError,
} = useBilling();
const { exporting, error: exportError, exportData } = useAccountExport();

const plan = ref({ ...FREE_ACCOUNT_PLAN });
onMounted(async () => {
  plan.value = await loadPlan();
});

const planLabel = computed(() =>
  plan.value.plan === "pro" ? "Pro plan" : "Free plan",
);
const trialEndsAt = computed(() =>
  plan.value.status === "trialing" && plan.value.trialEnd
    ? new Date(plan.value.trialEnd).toLocaleDateString()
    : null,
);

// Kept in the script (not inline template conditionals) so the billing copy
// reads as one sentence and the template stays flat.
const billingMessage = computed(() => {
  if (plan.value.plan !== "pro") {
    return "You're on the Free plan. Upgrade to Pro for unlimited sources.";
  }
  if (trialEndsAt.value) {
    return `You're on the Pro plan. Your trial ends ${trialEndsAt.value}.`;
  }
  return "You're on the Pro plan.";
});

function handleSignOut() {
  clerk.value?.signOut({ redirectUrl: "/login" });
}
</script>

<template>
  <section class="set-section">
    <h2>Account</h2>
    <p class="desc">Manage your Reader account.</p>
    <div class="conn">
      <AvatarButton class="h-12 w-12" />
      <div class="conn-info">
        <div class="conn-name">{{ user?.fullName }}</div>
        <div class="conn-desc">
          {{ user?.primaryEmailAddress?.emailAddress }}
        </div>
        <div class="conn-since">
          {{ planLabel }} · {{ feedStore.state.items.length }} items today
        </div>
      </div>
      <button class="btn" @click="handleSignOut">
        <RIcon name="logout" :size="16" /> Sign out
      </button>
    </div>
  </section>

  <section class="set-section">
    <h2>Billing</h2>
    <p class="desc billing-desc">{{ billingMessage }}</p>
    <NuxtLink v-if="plan.plan !== 'pro'" to="/pricing" class="btn btn-primary">
      Upgrade to Pro
    </NuxtLink>
    <button v-else class="btn" :disabled="billingLoading" @click="openPortal">
      <RIcon name="settings" :size="16" /> Manage subscription
    </button>
    <p v-if="billingError" class="desc billing-error">{{ billingError }}</p>
  </section>

  <section class="set-section">
    <h2>Your data</h2>
    <p class="desc">
      Download everything you've stored in Reader — your sources and saved
      items, plus your reading settings and connected accounts — as a JSON file.
    </p>
    <button class="btn" :disabled="exporting" @click="exportData">
      <RIcon name="download" :size="16" />
      {{ exporting ? "Preparing…" : "Export my data" }}
    </button>
    <p v-if="exportError" class="desc export-error">{{ exportError }}</p>
  </section>

  <section class="set-section">
    <h2>Edit profile</h2>
    <p class="desc">Update your name and profile photo.</p>
    <UserProfile />
  </section>

  <SettingsDeleteAccount />
</template>
