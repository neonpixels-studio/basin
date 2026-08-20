<script setup>
import { computed, ref } from "vue";

const feedStore = useFeedStore();

const { items: realFeeds, loading: feedsLoading, load: loadFeeds } = useFeeds();

const feedAdded = ref(false);
const isOnboarding = computed(
  () => !feedsLoading.value && realFeeds.value.length === 0 && !feedAdded.value,
);

onMounted(async () => {
  try {
    await loadFeeds();
    if (realFeeds.value.length > 0) {
      await feedStore.loadItems();
      await feedStore.loadCounts();
    }
  } catch (error) {
    console.error("Failed to load dashboard data:", error);
  }
});
</script>

<template>
  <main class="wrap">
    <DashboardSubbar
      :is-onboarding="isOnboarding"
      :source-count="realFeeds.length"
    />

    <!-- onboarding empty state -->
    <DashboardOnboarding v-if="isOnboarding" @feed-added="feedAdded = true" />

    <DashboardFeed v-else />
  </main>
</template>
