<script setup>
defineProps({
  paragraphs: { type: Array, required: true },
  emptyText: { type: String, required: true },
  // Pre-sanitized, allowlisted HTML from the feed store's contentHtml (built by
  // sanitizeFeedHtml). Empty string means the content is plain text (or absent),
  // so fall through to the paragraph / empty-state rendering below.
  html: { type: String, default: "" },
});
</script>

<template>
  <!-- `html` is already sanitized upstream (sanitizeFeedHtml) — never a raw feed
       string — so rendering it as markup is safe. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-if="html" class="detail-prose" v-html="html"></div>
  <div v-else class="detail-prose">
    <p v-for="(paragraph, index) in paragraphs" :key="index">
      {{ paragraph }}
    </p>
    <p v-if="!paragraphs.length" class="text-muted">
      {{ emptyText }}
    </p>
  </div>
</template>
