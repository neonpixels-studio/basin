<script setup>
import { computed } from "vue";

const feedStore = useFeedStore();
const state = feedStore.state;

const appearanceStore = useAppearanceStore();

const showSkeleton = computed(
  () =>
    state.loading &&
    (appearanceStore.state.loadingStyle === "skeleton" ||
      appearanceStore.state.loadingStyle === "both"),
);
const staggerOn = computed(
  () =>
    appearanceStore.state.loadingStyle === "fade" ||
    appearanceStore.state.loadingStyle === "both",
);
</script>

<template>
  <div class="feed" :class="'layout-' + state.layout">
    <!-- skeleton -->
    <div v-if="showSkeleton" class="feed-grid">
      <SkeletonCard
        v-for="(k, i) in feedStore.skeletonKinds"
        :key="'sk' + i"
        :kind="k"
      />
    </div>

    <!-- loaded -->
    <template v-else>
      <div
        v-if="!feedStore.visibleItems.length"
        class="empty flex flex-col items-center"
      >
        <RIcon name="inbox" :size="40" />
        <h3>You're all caught up</h3>
        <p>
          Nothing left in this filter. Try another source or pull to refresh.
        </p>
      </div>

      <DashboardFeedGrid
        v-else-if="state.layout !== 'columns'"
        :stagger="staggerOn"
      />

      <DashboardFeedColumns v-else :stagger="staggerOn" />
    </template>
  </div>
</template>

<style>
.feed {
  padding: 18px 0 80px;
}

/* empty state */
.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--muted);
}
.empty .ricon {
  color: var(--faint);
  margin-bottom: 14px;
}
.empty h3 {
  font-size: 15px;
  color: var(--ink);
  margin: 0 0 6px;
}
.empty p {
  font-size: 12.5px;
  margin: 0;
}

/* infinite scroll sentinel and status */
.feed-sentinel {
  height: 1px;
}
.feed-end,
.feed-loading-more {
  text-align: center;
  padding: 24px 0;
  font-size: 12.5px;
  color: var(--muted);
}

/* ---------- Layout variants ---------- */
/* timeline — single column, comfortable reading width */
.layout-timeline .feed-grid {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  max-width: 660px;
  margin: 0 auto;
}

/* grid — masonry-ish via columns */
.layout-grid .feed-grid {
  columns: 3 280px;
  column-gap: var(--gap);
}
.layout-grid .feed-grid > * {
  break-inside: avoid;
  margin-bottom: var(--gap);
  display: block;
}

/* columns — per-source decks */
.layout-columns .feed-cols {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(280px, 1fr);
  gap: var(--gap);
  overflow-x: auto;
  padding-bottom: 16px;
}
.deck {
  min-width: 0;
}
.deck-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px 12px;
  position: sticky;
  top: 0;
}
.deck-head .src-ic {
  width: 24px;
  height: 24px;
}
.deck-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}
.deck-count {
  font-size: 10px;
  color: var(--faint);
  margin-left: auto;
}
.deck-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (max-width: 720px) {
  .layout-grid .feed-grid {
    columns: 1;
  }
}
</style>
