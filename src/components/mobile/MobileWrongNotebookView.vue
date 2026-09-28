<template>
  <section class="mobile-panel mobile-notebook-page mobile-wrong-page">
    <div class="mobile-notebook-page-header mobile-wrong-page-header">
      <div>
        <span class="mobile-section-eyebrow">WRONG NOTEBOOK</span>
        <p class="mobile-kicker">{{ bankName }}</p>
        <h2>错题本</h2>
        <p class="mobile-muted">{{ notebooks.length }} 个错题本 · {{ totalEntryCount }} 道错题</p>
      </div>
    </div>

    <div class="mobile-notebook-toolbar mobile-wrong-toolbar">
      <button class="mobile-action mobile-wrong-tool mobile-wrong-tool-primary" type="button" @click="$emit('import')"><span aria-hidden="true">＋</span> 导入错题</button>
      <button class="mobile-action mobile-wrong-tool" type="button" @click="$emit('backupAll')"><span aria-hidden="true">↥</span> 备份全部</button>
      <button class="mobile-action mobile-wrong-tool" type="button" @click="$emit('restoreAll')"><span aria-hidden="true">↧</span> 恢复备份</button>
    </div>

    <div v-if="!notebooks.length" class="mobile-notebook-empty mobile-wrong-empty">
      <strong>还没有错题本</strong>
      <p class="mobile-muted">做题时加入错题，或导入一个 JSON 文件即可创建错题本。</p>
      <button class="mobile-action mobile-primary" type="button" @click="$emit('import')">导入错题</button>
    </div>

    <div v-else class="mobile-notebook-list">
      <MobileNotebookCard
        v-for="notebook in notebooks"
        :key="notebook.id"
        :notebook="notebook"
        :active="notebook.id === activeId"
        :entry-count="entryCounts[notebook.id] || 0"
        @start-practice="$emit('startPractice', notebook.id)"
        @set-active="$emit('setActive', notebook.id)"
        @rename="$emit('rename', notebook.id)"
        @export="$emit('export', notebook.id)"
        @delete="$emit('delete', notebook.id)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { WrongNotebook } from '../../types'
import MobileNotebookCard from './MobileNotebookCard.vue'

defineProps<{
  bankName: string
  notebooks: WrongNotebook[]
  activeId?: string
  entryCounts: Record<string, number>
  totalEntryCount: number
}>()
defineEmits<{
  (event: 'import'): void
  (event: 'backupAll'): void
  (event: 'restoreAll'): void
  (event: 'startPractice', notebookId: string): void
  (event: 'setActive', notebookId: string): void
  (event: 'rename', notebookId: string): void
  (event: 'export', notebookId: string): void
  (event: 'delete', notebookId: string): void
}>()
</script>
