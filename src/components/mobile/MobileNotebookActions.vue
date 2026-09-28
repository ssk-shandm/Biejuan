<template>
  <div class="mobile-notebook-actions" :class="{ compact }">
    <button class="mobile-action mobile-primary" type="button" @click="$emit('startPractice')">
      进入练习
    </button>
    <button v-if="!active" class="mobile-action" type="button" @click="$emit('setActive')">
      设为当前
    </button>
    <button class="mobile-action" type="button" @click="$emit('rename')">重命名</button>
    <button class="mobile-action" type="button" @click="$emit('export')">导出错题</button>
    <button class="mobile-action mobile-danger" type="button" @click="$emit('delete')">删除</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  active: boolean
  compact?: boolean
}>()
defineEmits<{
  (event: 'startPractice'): void
  (event: 'setActive'): void
  (event: 'rename'): void
  (event: 'export'): void
  (event: 'delete'): void
}>()
</script>
