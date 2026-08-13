<script setup>
defineProps({ item: { type: Object, required: true } });
defineEmits(["save", "star", "open"]);
</script>

<template>
  <div class="card-actions">
    <button
      class="icon-btn"
      :class="{ on: item.saved }"
      :title="item.saved ? 'Saved' : 'Save for later'"
      @click.stop="$emit('save')"
    >
      <RIcon :name="item.saved ? 'bookmarkFill' : 'bookmark'" :size="16" />
    </button>
    <button
      class="icon-btn"
      :class="{ on: item.starred }"
      :title="item.starred ? 'Starred' : 'Star'"
      @click.stop="$emit('star')"
    >
      <RIcon :name="item.starred ? 'starFill' : 'star'" :size="16" />
    </button>
    <button class="icon-btn" title="Open" @click.stop="$emit('open')">
      <RIcon name="bookOpen" :size="16" />
    </button>
  </div>
</template>

<style>
.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.card-actions .icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}
</style>
