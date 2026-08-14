<script setup>
import { computed } from "vue";
import ArticleCard from "./ArticleCard.vue";
import VideoCard from "./VideoCard.vue";
import PodcastCard from "./PodcastCard.vue";
import TweetCard from "./TweetCard.vue";

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(["save", "star", "open"]);

const map = {
  article: ArticleCard,
  video: VideoCard,
  podcast: PodcastCard,
  tweet: TweetCard,
};
const comp = computed(() => map[props.item.type]);
</script>

<template>
  <component
    :is="comp"
    :item="item"
    @save="$emit('save')"
    @star="$emit('star')"
    @open="$emit('open')"
  />
</template>
