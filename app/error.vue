<script setup>
// Nuxt renders this for fatal/500 errors (thrown server errors, failed data
// fetches, OAuth callback throws) instead of its generic unstyled page.
// Route misses still fall to pages/[...slug].vue; this mirrors that branding.
const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const HOME_PATH = "/dashboard";
const DEFAULT_STATUS_CODE = 500;
const DEFAULT_MESSAGE = "Something threw us off the trail.";
const SERVER_ERROR_THRESHOLD = 500;

const statusCode = computed(
  () => props.error?.statusCode ?? DEFAULT_STATUS_CODE,
);
const isServerError = computed(
  () => statusCode.value >= SERVER_ERROR_THRESHOLD,
);
// statusMessage is only trusted as user-facing copy on a 4xx: those are
// purpose-written H3 strings ("Not Found", "Forbidden"). On a 5xx it can
// carry raw thrown err.message text, upstream API detail, or DB driver
// output, so it's never shown — DEFAULT_MESSAGE is used instead regardless
// of what statusMessage contains. Never error.message either way, for the
// same reason. Server routes must never assign a raw caught err.message to
// statusMessage (they throw purpose-written errors today) or it could reach
// here on a 4xx.
const message = computed(() => {
  if (isServerError.value) {
    return DEFAULT_MESSAGE;
  }
  return props.error?.statusMessage || DEFAULT_MESSAGE;
});

useHead({ title: message });

function retry() {
  clearError();
}

function goHome() {
  clearError({ redirect: HOME_PATH });
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-10 text-center">
    <div>
      <div class="mb-7 flex justify-center opacity-90">
        <RLogo :size="74" />
      </div>
      <h1 class="m-0 text-[72px] leading-none font-bold tracking-tighter">
        {{ statusCode }}
      </h1>
      <div class="text-ink mt-3.5 mb-1.5 text-[16px]">
        {{ message }}
      </div>
      <p class="text-muted m-0 mb-7 text-[13px]">
        We hit a snag loading this. Try again, or head back to your feed.
      </p>
      <div class="flex justify-center gap-2.5">
        <button class="btn btn-primary" @click="retry">
          <RIcon name="refresh" :size="16" /> Try again
        </button>
        <button class="btn" @click="goHome">
          <RIcon name="inbox" :size="16" /> Back to your feed
        </button>
      </div>
    </div>
  </div>
</template>
