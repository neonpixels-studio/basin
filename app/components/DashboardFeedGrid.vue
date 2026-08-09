<script>
export const PAGE_SIZE = 20;

// visibleItems is filtered client-side while the API paginates unfiltered, so a
// fetched page may add zero items to the current filter. Bound how many pages a
// single scroll will pull chasing visible growth so a sparse filter can't fire
// an unbounded burst of requests; a manual "Load more" then takes over.
export const MAX_PAGES_PER_SCROLL = 5;
</script>

<script setup>
import { computed, ref } from "vue";

defineProps({
  stagger: {
    type: Boolean,
    default: false,
  },
});

const feedStore = useFeedStore();
const state = feedStore.state;

// Infinite scroll: a local reveal window over visibleItems, backed by real
// server pagination. We reveal loaded items PAGE_SIZE at a time; once the window
// reaches the end of what's loaded we ask the store to fetch and append the next
// page, so the feed is no longer capped at the first API page.
const visibleCount = ref(PAGE_SIZE);

// True when a scroll burst hit the per-scroll page bound (or a fetch failed)
// without revealing more items, so the sentinel can't self-recover — the manual
// "Load more" button is offered instead. A sparse filter or a full-screen short
// list keeps the sentinel intersecting with nothing to scroll, so without this
// the feed would silently dead-end.
const stalled = ref(false);

// Reset the window (and any stall) when the filter/unread toggle changes (those
// swap to a different client-side set) or when the store replaces the list with
// a fresh first page (listVersion bumps). Appending a fetched page grows
// visibleItems but leaves listVersion untouched, so an append never resets it.
watch(
  () => [state.filter, state.unreadOnly, state.listVersion],
  () => {
    visibleCount.value = PAGE_SIZE;
    stalled.value = false;
  },
);

const windowedItems = computed(() =>
  feedStore.visibleItems.slice(0, visibleCount.value),
);

const isEndOfFeed = computed(
  () =>
    !state.loading &&
    !feedStore.hasMore &&
    feedStore.visibleItems.length > 0 &&
    visibleCount.value >= feedStore.visibleItems.length,
);

function advanceWindow() {
  const nextCount = visibleCount.value + PAGE_SIZE;
  visibleCount.value = Math.min(nextCount, feedStore.visibleItems.length);
  stalled.value = false;
}

// GREW — page revealed new visible items; STOPPED — fetch failed/no-op, give up
// this burst; NO_MATCH — page landed but nothing passed the filter, try again.
const PAGE_RESULT = { GREW: "grew", STOPPED: "stopped", NO_MATCH: "no-match" };

async function pullOnePage(startCount) {
  const fetched = await feedStore.loadMore();
  if (!fetched) {
    return PAGE_RESULT.STOPPED;
  }
  if (feedStore.visibleItems.length > startCount) {
    return PAGE_RESULT.GREW;
  }
  return PAGE_RESULT.NO_MATCH;
}

async function fetchUntilVisibleGrowth() {
  stalled.value = false;
  const burstVersion = state.listVersion;
  const startCount = feedStore.visibleItems.length;
  let attempts = 0;
  while (feedStore.hasMore && attempts < MAX_PAGES_PER_SCROLL) {
    attempts += 1;
    const status = await pullOnePage(startCount);
    if (status === PAGE_RESULT.GREW) {
      advanceWindow();
      return;
    }
    if (status === PAGE_RESULT.STOPPED) {
      break;
    }
  }
  // A fresh first page landed mid-burst (refresh/filter) — the reset watch owns
  // the new list's state, so don't stamp a stall from this superseded burst.
  if (state.listVersion !== burstVersion) {
    return;
  }
  // More pages exist but this burst surfaced nothing — offer manual recovery.
  stalled.value = feedStore.hasMore;
}

// Serialize bursts so an overlapping sentinel fire can't observe a mid-flight
// load as a stall (loadMore's own guard would return false and set stalled true
// even though the first burst is about to succeed).
const fetching = ref(false);

async function loadNextPage() {
  if (fetching.value) {
    return;
  }
  if (visibleCount.value < feedStore.visibleItems.length) {
    advanceWindow();
    return;
  }
  if (!feedStore.hasMore) {
    return;
  }
  fetching.value = true;
  try {
    await fetchUntilVisibleGrowth();
  } finally {
    fetching.value = false;
  }
}

const sentinelEl = ref(null);
useInfiniteScroll(sentinelEl, loadNextPage);
</script>

<template>
  <div class="feed-grid" :class="{ 'reveal-done': state.revealDone }">
    <FeedItem
      v-for="(item, i) in windowedItems"
      :key="item.id"
      :item="item"
      :class="stagger ? 'stagger' : ''"
      :style="{ '--i': i }"
      @save="feedStore.toggleSave(item)"
      @open="feedStore.openItem(item)"
    />

    <!-- sentinel: triggers next page load when it scrolls into view -->
    <div
      v-if="!isEndOfFeed && !stalled"
      ref="sentinelEl"
      class="feed-sentinel"
      aria-hidden="true"
    ></div>

    <div v-if="state.loadingMore" class="feed-loading-more" aria-live="polite">
      Loading more…
    </div>

    <button
      v-if="stalled && !state.loadingMore"
      type="button"
      class="feed-load-more"
      @click="loadNextPage"
    >
      Load more
    </button>

    <div v-if="isEndOfFeed" class="feed-end" aria-live="polite">
      You've reached the end
    </div>
  </div>
</template>
