<script setup>
defineProps({
  paragraphs: { type: Array, required: true },
  emptyText: { type: String, required: true },
});
</script>

<template>
  <div class="detail-prose">
    <p v-for="(paragraph, index) in paragraphs" :key="index">
      {{ paragraph }}
    </p>
    <p v-if="!paragraphs.length" class="text-muted">
      {{ emptyText }}
    </p>
  </div>
</template>
