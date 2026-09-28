<template>
  <article class="mobile-notebook-card" :class="{ active }">
    <div class="mobile-notebook-card-header">
      <div class="mobile-notebook-title-wrap">
        <span v-if="active" class="mobile-notebook-badge">当前</span>
        <h3>{{ notebook.name }}</h3>
      </div>
      <span class="mobile-notebook-count">{{ entryCount }} 道错题</span>
    </div>
    <p class="mobile-notebook-meta">创建于 {{ formatDate(notebook.createdAt) }}</p>
    <MobileNotebookActions
      :active="active"
      :compact="!expanded"
      @start-practice="$emit('startPractice')"
      @set-active="$emit('setActive')"
      @rename="$emit('rename')"
      @export="$emit('export')"
      @delete="$emit('delete')"
    />
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WrongNotebook } from '../../types'
import MobileNotebookActions from './MobileNotebookActions.vue'

const props = defineProps<{
  notebook: WrongNotebook
  active: boolean
  entryCount: number
}>()
defineEmits<{
  (event: 'startPractice'): void
  (event: 'setActive'): void
  (event: 'rename'): void
  (event: 'export'): void
  (event: 'delete'): void
}>()

// Keep the full action row visible on mobile: every action remains a touch target.
const expanded = computed(() => props.active || props.entryCount > 0)

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('zh-CN')
}
</script>
