<script setup>
import { computed, ref } from "vue";
import { durationLabel } from "~/utils/duration";
import { VIDEO_PLACEHOLDER_LABEL } from "~/utils/itemContent";

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(["save", "open"]);

const appearanceStore = useAppearanceStore();
const videoRef = ref(null);
// Feed thumbnails are untrusted cross-origin URLs; on a load failure fall back
// to the striped placeholder instead of a broken-image glyph.
const imageFailed = ref(false);

const thumbnailUrl = computed(() =>
  props.item.imageUrl && !imageFailed.value ? props.item.imageUrl : null,
);

const videoDurationLabel = computed(() =>
  durationLabel(props.item.mediaDuration),
);

function handleMouseEnter() {
  if (appearanceStore.state.autoplay && videoRef.value) {
    videoRef.value.play().catch(() => {});
  }
}

function handleMouseLeave() {
  if (!appearanceStore.state.autoplay || !videoRef.value) {
    return;
  }
  videoRef.value.pause();
  videoRef.value.currentTime = 0;
}

function handleVideoClick(event) {
  if (!appearanceStore.state.autoplay) {
    event.stopPropagation();
  }
}
</script>

<template>
  <article
    class="card card-video"
    @click="$emit('open')"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div
      class="thumb ratio-16x9"
      :class="{ ph: !thumbnailUrl }"
      :data-label="thumbnailUrl ? undefined : VIDEO_PLACEHOLDER_LABEL"
    >
      <img
        v-if="thumbnailUrl"
        class="thumb-img"
        :src="thumbnailUrl"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="imageFailed = true"
      />
      <video
        v-if="item.mediaUrl"
        ref="videoRef"
        class="thumb-video"
        :src="item.mediaUrl"
        :controls="!appearanceStore.state.autoplay"
        :tabindex="appearanceStore.state.autoplay ? -1 : 0"
        :aria-hidden="appearanceStore.state.autoplay ? 'true' : undefined"
        muted
        playsinline
        loop
        preload="none"
        @click="handleVideoClick"
      ></video>
      <span class="thumb-play"><RIcon name="play" :size="22" /></span>
      <span v-if="videoDurationLabel" class="thumb-dur">{{
        videoDurationLabel
      }}</span>
    </div>
    <div class="card-body">
      <div class="card-head">
        <SourceTag :item="item" />
        <CardActions :item="item" @save="$emit('save')" @open="$emit('open')" />
      </div>
      <h3 class="card-title">{{ item.title }}</h3>
    </div>
  </article>
</template>

<style>
.card-video {
  padding: 0;
}
.card-video .card-body {
  padding: 14px var(--card-pad) var(--card-pad);
}
.card-video .thumb {
  border-radius: 0;
}
.thumb {
  width: 100%;
  position: relative;
}
.ratio-16x9 {
  aspect-ratio: 16/9;
}
.ratio-1x1 {
  aspect-ratio: 1/1;
}
.thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}
.thumb-play {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: color-mix(in oklab, #000 55%, transparent);
  color: #fff;
  backdrop-filter: blur(2px);
  transition:
    transform 0.2s var(--ease),
    background 0.2s;
  z-index: 2;
}
.card-video:hover .thumb-play {
  transform: scale(1.08);
  background: var(--accent);
}
.thumb-dur {
  position: absolute;
  right: 8px;
  bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: color-mix(in oklab, #000 70%, transparent);
  padding: 3px 7px;
  border-radius: 6px;
  z-index: 2;
}
</style>
