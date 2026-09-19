<script setup>
defineProps({
  paragraphs: { type: Array, required: true },
  emptyText: { type: String, required: true },
  // Pre-sanitized, allowlisted HTML from the feed store's contentHtml (built by
  // sanitizeFeedHtml). The name is deliberate: the v-html sink below trusts this
  // to be sanitized already, so callers must pass sanitized markup only. Empty
  // string means plain text (or absent) — fall through to the paragraph /
  // empty-state rendering below.
  sanitizedHtml: { type: String, default: "" },
});
</script>

<template>
  <!-- sanitizedHtml is produced by sanitizeFeedHtml — never a raw feed string —
       so rendering it as markup is safe. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-if="sanitizedHtml" class="detail-prose" v-html="sanitizedHtml"></div>
  <div v-else class="detail-prose">
    <p v-for="(paragraph, index) in paragraphs" :key="index">
      {{ paragraph }}
    </p>
    <p v-if="!paragraphs.length" class="text-muted">
      {{ emptyText }}
    </p>
  </div>
</template>
