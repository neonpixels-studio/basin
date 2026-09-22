<script setup>
const {
  items,
  newUrl,
  loading,
  isAdding,
  discovering,
  detecting,
  error,
  detectedSource,
  sourceOverride,
  pendingFeedUrl,
  importing,
  exporting,
  importSummary,
  add,
  confirmAdd,
  remove,
  load,
  importOpml,
  exportOpml,
  retryFeed,
  isRetrying,
} = useFeeds();
onMounted(load);

const busy = computed(
  () => isAdding.value || discovering.value || detecting.value,
);

const buttonLabel = computed(() => {
  if (discovering.value) return "Finding feed…";
  if (detecting.value) return "Detecting type…";
  if (isAdding.value) return "Adding…";
  return "Add feed";
});

const detectedLabel = computed(() => {
  if (!detectedSource.value) return null;
  return detectedSource.value === "podcast" ? "Podcast" : "RSS";
});

const effectiveSource = computed(
  () => sourceOverride.value ?? detectedSource.value,
);

const showDetectConfirm = computed(
  () => Boolean(pendingFeedUrl.value) && Boolean(detectedSource.value),
);

const confirmButtonLabel = computed(() => {
  if (isAdding.value) {
    return "Adding…";
  }
  const label = effectiveSource.value === "podcast" ? "Podcast" : "RSS";
  return `Add as ${label}`;
});

const showLoadingState = computed(() => loading.value && !items.value.length);
const showEmptyState = computed(() => !items.value.length);

function sourceColor(source) {
  return source === "podcast" ? "var(--src-podcast)" : "var(--src-rss)";
}

function feedIcon(source) {
  return source === "podcast" ? "mic" : "rss";
}

function cancelDetection() {
  sourceOverride.value = null;
  detectedSource.value = null;
  pendingFeedUrl.value = null;
}

function needsAttention(feed) {
  return feed.syncStatus === "error";
}

// A paused feed (over the Free plan's source cap) always 409s the retry
// endpoint — see server/api/feeds/[id]/retry.post.ts — so the control is
// hidden rather than offering an action that can never succeed.
function canRetry(feed) {
  return needsAttention(feed) && !feed.paused;
}
</script>

<template>
  <section class="set-section">
    <h2>RSS &amp; Podcasts</h2>
    <p class="desc">
      Paste a feed URL or a plain website address — Reader will find the feed
      automatically.
    </p>

    <div class="add-feed">
      <InputText
        v-model="newUrl"
        placeholder="https://example.com or https://example.com/feed.xml"
        :error="error ?? undefined"
        :disabled="busy"
        @keyup.enter="add"
      >
        <template #icon>
          <RIcon name="rss" :size="16" />
        </template>
      </InputText>
      <button class="btn btn-primary" :disabled="busy" @click="add">
        <RIcon name="plus" :size="16" /> {{ buttonLabel }}
      </button>
    </div>

    <div v-if="showDetectConfirm" class="detect-confirm">
      <p class="detect-label">
        Detected:
        <strong>{{ detectedLabel }}</strong>
      </p>

      <div class="detect-override">
        <label for="source-override">Override type:</label>
        <select id="source-override" v-model="sourceOverride">
          <option :value="null">{{ detectedLabel }} (detected)</option>
          <option value="rss">RSS</option>
          <option value="podcast">Podcast</option>
        </select>
      </div>

      <div class="detect-actions">
        <button
          class="btn btn-primary"
          :disabled="isAdding"
          @click="confirmAdd"
        >
          <RIcon name="plus" :size="16" />
          {{ confirmButtonLabel }}
        </button>
        <button class="btn" :disabled="isAdding" @click="cancelDetection">
          Cancel
        </button>
      </div>
    </div>

    <FeedOpmlActions
      :importing="importing"
      :exporting="exporting"
      :import-summary="importSummary"
      @import-file="importOpml"
      @export="exportOpml"
    />

    <div class="feed-list">
      <div v-for="fd in items" :key="fd.id" class="feed-row">
        <span class="feed-ic" :style="{ '--c': sourceColor(fd.source) }">
          <RIcon :name="feedIcon(fd.source)" :size="16" />
        </span>
        <div class="feed-info">
          <div class="feed-name">{{ fd.title ?? fd.url }}</div>
          <div class="feed-url">{{ fd.url }}</div>
        </div>
        <span
          v-if="needsAttention(fd)"
          class="feed-stat error"
          :title="fd.syncError ?? 'Needs attention'"
        >
          <RIcon name="alertTriangle" :size="12" />
          Needs attention
        </span>
        <button
          v-if="canRetry(fd)"
          class="icon-btn"
          :title="isRetrying(fd.id) ? 'Retrying…' : 'Retry now'"
          :disabled="isRetrying(fd.id)"
          @click="retryFeed(fd.id)"
        >
          <RIcon name="refresh" :size="16" />
        </button>
        <button class="icon-btn" title="Remove" @click="remove(fd.id)">
          <RIcon name="trash" :size="16" />
        </button>
      </div>
      <p v-if="showLoadingState" class="desc">Loading…</p>
      <p v-else-if="showEmptyState" class="desc">No feeds added yet.</p>
    </div>
  </section>
</template>
