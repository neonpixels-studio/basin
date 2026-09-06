<script setup>
import { onMounted, onUnmounted, computed } from "vue";
import { isUnauthenticatedRoute } from "~/utils/publicPaths";

const appearanceStore = useAppearanceStore();
const route = useRoute();

// Marketing pages and /login paint before any authenticated theming could
// possibly apply — never hold them behind the settings-load cloak (see
// appearanceStore.ready below). This is what lets conversion pages hit
// first paint without waiting on /api/settings/reading.
const skipCloak = computed(() => isUnauthenticatedRoute(route.path));

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
