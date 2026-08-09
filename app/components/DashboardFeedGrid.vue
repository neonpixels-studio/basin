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

// Serialize bursts so an overlapping sentinel fire can't kick off a second one
// mid-flight, and so the template can show a single "loading more" state for the
// whole multi-page burst rather than flickering per request.
const fetching = ref(false);

// Reset the window when the filter/unread toggle changes (those swap to a
// different client-side set) or when the store replaces the list with a fresh
// first page (listVersion bumps). Appending a fetched page grows visibleItems
// but leaves listVersion untouched, so an append never resets the window.
watch(
  [() => state.filter, () => state.unreadOnly, () => state.listVersion],
  () => {
    visibleCount.value = PAGE_SIZE;
  },
);

const windowedItems = computed(() =>
  feedStore.visibleItems.slice(0, visibleCount.value),
);

const windowFullyRevealed = computed(
  () => visibleCount.value >= feedStore.visibleItems.length,
);

const isEndOfFeed = computed(
  () =>
    !state.loading &&
    !feedStore.hasMore &&
    feedStore.visibleItems.length > 0 &&
    windowFullyRevealed.value,
);

// Offer a manual "Load more" whenever we're idle, everything loaded is revealed,
// and the server still has pages. Escape hatch for cases the sentinel can't
// self-recover: a burst that hit the per-scroll bound, or a failed page fetch.
// In the normal case it appears only for the instant before the sentinel fires.
// (A filter with zero matches on page 1 shows the parent's empty state instead;
// deeper search for empty filters is out of scope here — see PR follow-ups.)
const canManuallyLoad = computed(
  () =>
    !state.loading &&
    !state.loadingMore &&
    !fetching.value &&
    feedStore.hasMore &&
    windowFullyRevealed.value,
);

function advanceWindow() {
  const nextCount = visibleCount.value + PAGE_SIZE;
  visibleCount.value = Math.min(nextCount, feedStore.visibleItems.length);
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
      return;
    }
  }
}

async function loadNextPage() {
  // Deliberately not gated on state.loading: that's a cosmetic reveal timer (see
  // feed.ts), and gating an intersection-only callback on it can permanently
  // drop a fire. A page fetched during a concurrent first-page load is dropped
  // safely by the store's listVersion guard, and loadMore blocks on
  // loadingFirstPage, so no gate is needed here.
  if (fetching.value) {
    return;
  }
  if (!windowFullyRevealed.value) {
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

    <!-- sentinel: auto-triggers the next page as it scrolls into view -->
    <div
      v-if="!isEndOfFeed"
      ref="sentinelEl"
      class="feed-sentinel"
      aria-hidden="true"
    ></div>

    <div v-if="fetching" class="feed-loading-more" aria-live="polite">
      Loading more…
    </div>

    <!-- manual escape hatch when the sentinel can't self-recover -->
    <button
      v-if="canManuallyLoad"
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
