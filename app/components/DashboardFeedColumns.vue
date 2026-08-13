<script setup>
defineProps({
  stagger: {
    type: Boolean,
    default: false,
  },
});

const feedStore = useFeedStore();
const state = feedStore.state;
</script>

<template>
  <div class="feed-cols">
    <section v-for="d in feedStore.decks" :key="d.type" class="deck">
      <div class="deck-head">
        <span
          class="src-ic"
          :class="d.meta.cls"
          :style="{ '--c': 'var(--' + d.meta.cls + ')' }"
          ><RIcon :name="d.meta.icon" :size="14"
        /></span>
        <span class="deck-title">{{ d.meta.label }}</span>
        <span class="deck-count">{{ d.items.length }}</span>
      </div>
      <div class="deck-body" :class="{ 'reveal-done': state.revealDone }">
        <FeedItem
          v-for="(item, i) in d.items"
          :key="item.id"
          :item="item"
          :class="stagger ? 'stagger' : ''"
          :style="{ '--i': i }"
          @save="feedStore.toggleSave(item)"
          @star="feedStore.toggleStar(item)"
          @open="feedStore.openItem(item)"
        />
      </div>
    </section>
  </div>
</template>
