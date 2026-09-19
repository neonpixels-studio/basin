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
const CLIENT_ERROR_RANGE_START = 400;
const CLIENT_ERROR_RANGE_END = 499;

const statusCode = computed(
  () => props.error?.statusCode ?? DEFAULT_STATUS_CODE,
);
// Trust statusMessage only inside the 4xx range, not merely "not a 5xx" —
// that also excludes an unexpected 3xx/2xx/0/NaN statusCode, none of which
// this app's routes ever throw with a user-facing statusMessage, so they
// fall back to DEFAULT_MESSAGE like a 5xx would rather than assuming
// they're safe to show.
const isClientError = computed(
  () =>
    statusCode.value >= CLIENT_ERROR_RANGE_START &&
    statusCode.value <= CLIENT_ERROR_RANGE_END,
);
// statusMessage is only trusted as user-facing copy on a 4xx, because every
// 4xx this app's own server routes throw is a fixed, purpose-written string
// (see server/api/**, server/utils/urlValidator.ts's H3 wrapper) — never an
// interpolated request value. That's an invariant of this codebase's routes,
// not a guarantee Nuxt/H3 make generally, so a new route must keep following
// it: never assign a raw caught err.message, or an interpolated user input,
// to statusMessage on a 4xx it throws. Outside the 4xx range (5xx, or any
// other/unexpected status) statusMessage can carry raw thrown err.message
// text, upstream API detail, or DB driver output, so it's never shown —
// DEFAULT_MESSAGE is used instead regardless of what statusMessage
// contains. Never error.message either way, for the same reason. Route
// misses never reach here at all (see the file-top comment): they fall to
// pages/[...slug].vue's fixed copy instead of Nuxt's built-in 404, which
// can otherwise echo the requested path back into statusMessage.
const message = computed(() => {
  if (isClientError.value) {
    return props.error?.statusMessage || DEFAULT_MESSAGE;
  }
  return DEFAULT_MESSAGE;
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
