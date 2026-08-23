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

const statusCode = computed(
  () => props.error?.statusCode ?? DEFAULT_STATUS_CODE,
);
// Only surface statusMessage — never error.message, which can carry raw JS
// throw text, upstream API detail, or DB driver messages to the end user.
const message = computed(() => props.error?.statusMessage || DEFAULT_MESSAGE);

useHead({ title: message });

function retry() {
  clearError();
}

function goHome() {
  clearError({ redirect: HOME_PATH });
}
</script>

<template>
  <div
    role="alert"
    class="grid min-h-screen place-items-center p-10 text-center"
  >
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
