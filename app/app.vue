<script setup>
import { onMounted, onUnmounted, computed } from "vue";
import { isCloakExemptPath } from "~/utils/publicPaths";

const appearanceStore = useAppearanceStore();
const route = useRoute();

// Marketing pages and /login don't depend on the visitor's personalized
// theme to render correctly — never hold their first paint behind the
// settings-load cloak (see appearanceStore.ready below). This is what lets
// conversion pages paint instantly instead of waiting on
// /api/settings/reading (or on Clerk resolving whether there even is a
// signed-in visitor to fetch settings for).
const skipCloak = computed(() => isCloakExemptPath(route.path));

const feedStore = useFeedStore();
const state = feedStore.state;
const { setupWatchers, closeDetail, detailNav } = feedStore;

const { state: search, openSearch, closeSearch } = useSearch();

const isCmdK = (e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";

const DETAIL_ACTIONS = {
  ArrowRight: (e) => {
    e.preventDefault();
    detailNav(1);
  },
  ArrowLeft: (e) => {
    e.preventDefault();
    detailNav(-1);
  },
  Escape: () => closeDetail(),
};

function handleCmdK(e) {
  if (!isCmdK(e)) return false;
  e.preventDefault();
  if (search.open) closeSearch();
  else openSearch();
  return true;
}

function handleDetailNav(e) {
  if (!state.activeItem || search.open) return false;
  const action = DETAIL_ACTIONS[e.key];
  if (action) {
    action(e);
    return true;
  }
  return false;
}

function handleSlash(e) {
  if (search.open || e.key !== "/") return;
  if (/input|textarea/i.test(e.target.tagName)) return;
  e.preventDefault();
  openSearch();
}

function onKey(e) {
  if (handleCmdK(e)) return;
  if (handleDetailNav(e)) return;
  handleSlash(e);
}

onMounted(() => {
  // Deferred to onMounted (not run eagerly at store-setup time) so the
  // client's first render matches the server's default-appearance render
  // exactly — hydration completes cleanly, and loadFromDb()'s cache/DB
  // apply then lands as a normal post-mount reactive update instead of
  // racing Nuxt's Pinia state hydration, which otherwise either reverts the
  // just-applied settings back to defaults (and re-persists that revert) or
  // produces a hydration mismatch that Vue skips patching for. See
  // appearanceStore's init() for the full explanation.
  appearanceStore.init();
  setupWatchers();
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'app-ready': appearanceStore.ready || skipCloak }"
  >
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- app-wide overlays -->
    <SearchOverlay />
    <ReaderDetail />
    <AppToast />
    <SyncQueueAlert />
  </div>
</template>
