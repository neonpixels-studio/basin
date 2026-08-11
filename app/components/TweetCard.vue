<script setup>
import { computed } from "vue";
import { contentText } from "~/utils/itemContent";

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(["save", "open"]);

const initials = computed(() =>
  props.item.source
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join(""),
);
const postText = computed(() => contentText(props.item.content));
</script>

<template>
  <article class="card card-tweet" @click="$emit('open')">
    <div class="tw-head">
      <span class="avatar src-tweet">{{ initials }}</span>
      <div class="tw-id">
        <b>{{ item.source }}</b>
        <span class="tw-handle">{{ item.handle }} · {{ item.time }}</span>
      </div>
      <span class="tw-glyph src-tweet"><RIcon name="chat" :size="15" /></span>
    </div>
    <p v-if="postText" class="tw-text">{{ postText }}</p>
    <div class="tw-actions">
      <button
        class="icon-btn ml-auto"
        :class="{ on: item.saved }"
        @click.stop="$emit('save')"
      >
        <RIcon :name="item.saved ? 'bookmarkFill' : 'bookmark'" :size="15" />
      </button>
    </div>
  </article>
</template>

<style>
.card-tweet {
  display: flex;
  flex-direction: column;
}
.tw-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 11px;
}
.avatar {
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  background: color-mix(in oklab, var(--c) 18%, transparent);
  color: var(--c);
}
.tw-id {
  min-width: 0;
  flex: 1;
  line-height: 1.3;
}
.tw-id b {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  display: block;
}
.tw-handle {
  font-size: 11.5px;
  color: var(--muted);
}
.tw-glyph {
  color: var(--c);
  opacity: 0.7;
}
.tw-text {
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink);
  margin: 0;
  text-wrap: pretty;
}
.tw-actions {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 14px;
  color: var(--muted);
  font-size: 12px;
}
.tw-actions span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ml-auto {
  margin-left: auto;
}
</style>
