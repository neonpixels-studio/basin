<script setup>
import { computed } from "vue";
import { contentText } from "~/utils/itemContent";

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(["save", "star", "open"]);

const excerpt = computed(() => contentText(props.item.content));
const hasTags = computed(() => Boolean(props.item.tags?.length));
</script>

<template>
  <article
    class="card card-article"
    :class="{ unread: item.unread }"
    @click="$emit('open')"
  >
    <div class="card-head">
      <SourceTag :item="item" />
      <CardActions
        :item="item"
        @save="$emit('save')"
        @star="$emit('star')"
        @open="$emit('open')"
      />
    </div>
    <h3 class="card-title">{{ item.title }}</h3>
    <p v-if="excerpt" class="card-excerpt">{{ excerpt }}</p>
    <div v-if="hasTags" class="card-foot">
      <div class="chips">
        <span v-for="t in item.tags" :key="t" class="chip">#{{ t }}</span>
      </div>
    </div>
  </article>
</template>
