<script setup>
import { computed } from "vue";
import { durationLabel } from "~/composables/usePodcastPlayer";
import { contentText } from "~/utils/itemContent";

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(["save", "open"]);

const player = usePodcastPlayer();

const excerpt = computed(() => contentText(props.item.content));

const mediaUrl = computed(() => props.item.mediaUrl || null);
const canPlay = computed(() => player.canPlay(mediaUrl.value));
const active = computed(() => player.isActive(mediaUrl.value));
const playing = computed(() => player.isPlaying(mediaUrl.value));

const progressPct = computed(() =>
  active.value ? Math.round(player.progress * 100) : 0,
);

const totalSeconds = computed(() => {
  if (active.value && player.state.duration > 0) {
    return player.state.duration;
  }
  return Number(props.item.mediaDuration) || 0;
});

const totalLabel = computed(() => durationLabel(totalSeconds.value));

const playbackLabel = computed(() =>
  active.value
    ? `${player.formatTime(player.state.currentTime)} / ${totalLabel.value}`
    : totalLabel.value,
);

function togglePlay() {
  player.toggle(mediaUrl.value);
}
</script>

<template>
  <article class="card card-podcast">
    <div class="pod-top" @click="$emit('open')">
      <div class="pod-cover ph ratio-1x1" data-label="cover">
        <RIcon name="mic" :size="20" />
      </div>
      <div class="pod-main">
        <div class="card-head">
          <SourceTag :item="item" />
          <CardActions
            :item="item"
            @save="$emit('save')"
            @open="$emit('open')"
          />
        </div>
        <h3 class="card-title">{{ item.title }}</h3>
        <p v-if="excerpt" class="card-excerpt sm">{{ excerpt }}</p>
      </div>
    </div>
    <div class="pod-player">
      <button
        class="pod-play"
        :title="playing ? 'Pause episode' : 'Play episode'"
        :disabled="!canPlay"
        @click.stop="togglePlay"
      >
        <RIcon :name="playing ? 'pause' : 'play'" :size="15" />
      </button>
      <div
        class="pod-bar"
        :class="{ 'pod-bar-seekable': active }"
        @click.stop="player.scrubTo(mediaUrl, $event)"
      >
        <i :style="{ width: progressPct + '%' }"></i>
      </div>
      <span class="pod-dur">{{ playbackLabel }}</span>
    </div>
  </article>
</template>

<style>
.pod-top {
  display: flex;
  gap: 14px;
}
.pod-cover {
  width: 76px;
  height: 76px;
  flex: none;
  color: var(--src-podcast);
}
.pod-main {
  min-width: 0;
  flex: 1;
}
.pod-player {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.pod-play {
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 50%;
  border: 0;
  cursor: pointer;
  background: var(--src-podcast);
  color: #fff;
  display: grid;
  place-items: center;
  transition: transform 0.15s var(--ease);
}
.pod-play:hover:not(:disabled) {
  transform: scale(1.08);
}
.pod-play:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pod-bar {
  flex: 1;
  height: 5px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.pod-bar-seekable {
  cursor: pointer;
}
.pod-bar i {
  display: block;
  height: 100%;
  background: var(--src-podcast);
  border-radius: 999px;
}
.pod-dur {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
</style>
