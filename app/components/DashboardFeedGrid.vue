<script setup>
import { computed, ref } from "vue";

const PAGE_SIZE = 20;

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

// Reset the window when the filter/unread toggle changes (those swap to a
// different client-side set) or when the store replaces the list with a fresh
// first page (listVersion bumps). Appending a fetched page grows visibleItems
// but leaves listVersion untouched, so an append never resets the window.
watch(
  () => [state.filter, state.unreadOnly, state.listVersion],
  () => {
    visibleCount.value = PAGE_SIZE;
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
}

async function loadNextPage() {
  if (visibleCount.value < feedStore.visibleItems.length) {
    advanceWindow();
    return;
  }
  if (!feedStore.hasMore) {
    return;
  }
  const appended = await feedStore.loadMore();
  if (!appended) {
    return;
  }
  advanceWindow();
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
      v-if="!isEndOfFeed"
      ref="sentinelEl"
      class="feed-sentinel"
      aria-hidden="true"
    ></div>

    <div v-if="state.loadingMore" class="feed-loading-more" aria-live="polite">
      Loading more…
    </div>

    <div v-if="isEndOfFeed" class="feed-end" aria-live="polite">
      You've reached the end
    </div>
  </div>
</template>
