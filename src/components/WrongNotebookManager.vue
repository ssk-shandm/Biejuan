<template>
  <div class="wrong-manage-page">
    <div class="wm-header">
      <button class="toolbar-btn back-home" @click="$emit('back')">← 返回首页</button>
      <h2>📒 错题本管理</h2>
      <p class="wm-subtitle">当前题库：{{ bankName }}</p>
    </div>

    <!-- 导入/导出 -->
    <div class="wm-actions">
      <button @click="$emit('import')" class="mode-btn import-btn">导入错题 (JSON)</button>
      <button v-if="totalEntryCount > 0" @click="$emit('export')" class="mode-btn export-btn">导出当前错题本</button>
    </div>

    <!-- 错题本列表 -->
    <div class="wm-notebooks">
      <div v-if="notebooks.length === 0" class="wm-empty">
        还没有错题本。在「做题模式」或「考试模式」中添加错题后会自动创建，也可以通过「导入错题」来创建。
      </div>

      <div
        v-for="nb in notebooks"
        :key="nb.id"
        class="wm-nb-card"
        :class="{ active: nb.id === activeId }"
      >
        <div class="wm-nb-info" @click="editingId !== nb.id && $emit('setActive', nb.id)">
          <template v-if="editingId === nb.id">
            <input
              v-model="editName"
              class="wm-nb-rename-input"
              @keydown.enter="confirmEdit()"
              @keydown.esc="cancelEdit()"
              @blur="confirmEdit()"
              @click.stop
            />
          </template>
          <template v-else>
            <span class="wm-nb-name">{{ nb.name }}</span>
            <span class="wm-nb-count">（{{ entryCounts[nb.id] || 0 }} 道错题）</span>
            <span class="wm-nb-date">{{ formatDate(nb.createdAt) }}</span>
          </template>
        </div>
        <div class="wm-nb-actions">
          <button
            v-if="editingId !== nb.id"
            @click="startEdit(nb)"
            class="btn-edit"
            title="重命名"
          >✏️</button>
          <button @click="$emit('startPractice', nb.id)" class="mode-btn practice-btn">开始练习</button>
          <button @click="$emit('delete', nb.id)" class="btn-delete" title="删除该错题本">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import type { WrongNotebook } from '../types'

defineProps<{
  notebooks: WrongNotebook[]
  activeId?: string
  bankName: string
  totalEntryCount: number
  /** 每个笔记本的条目数 */
  entryCounts: Record<string, number>
}>()

const emit = defineEmits<{
  back: []
  import: []
  export: []
  setActive: [notebookId: string]
  startPractice: [notebookId: string]
  delete: [notebookId: string]
  rename: [notebookId: string, newName: string]
}>()

const editingId = ref<string | null>(null)
const editName = ref('')

function startEdit(nb: WrongNotebook) {
  editingId.value = nb.id
  editName.value = nb.name
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.wm-nb-rename-input')
    input?.focus()
    input?.select()
  })
}

function confirmEdit() {
  if (editingId.value && editName.value.trim()) {
    emit('rename', editingId.value, editName.value.trim())
  }
  cancelEdit()
}

function cancelEdit() {
  editingId.value = null
  editName.value = ''
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.wrong-manage-page {
  max-width: 600px;
  margin: 20px auto;
  padding: 30px;
  background: var(--color-bg-container);
  border-radius: 12px;
  box-shadow: var(--color-shadow-container);
  border: 1px solid var(--color-border-container);
  color: var(--color-text-primary);
}
.wm-header {
  margin-bottom: 24px;
}
.wm-header h2 {
  margin: 12px 0 4px;
}
.wm-subtitle {
  font-size: 0.9rem;
  color: var(--color-text-muted);
  margin: 0;
}
.wm-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}
.mode-btn {
  padding: 10px 20px;
  font-size: 0.95rem;
  border: 1px solid var(--color-border-btn-mode);
  border-radius: 8px;
  background-color: var(--color-bg-btn-mode);
  cursor: pointer;
  font-weight: 600;
  color: var(--color-text-btn-mode);
  transition: all 0.2s;
}
.mode-btn:hover { transform: translateY(-1px); }
.import-btn { color: var(--color-accent); border-color: var(--color-accent); }
.export-btn { color: var(--color-accent); border-color: var(--color-accent); }
.wm-notebooks {
  margin-bottom: 20px;
}
.wm-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.9rem;
  border: 2px dashed var(--color-border-divider);
  border-radius: 10px;
}
.wm-nb-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border: 1px solid var(--color-border-divider);
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.15s;
}
.wm-nb-card:hover { border-color: var(--color-accent); }
.wm-nb-card.active {
  border-color: var(--color-accent);
  background: rgba(74, 144, 217, 0.06);
}
.wm-nb-info {
  flex: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wm-nb-name {
  font-weight: 600;
  font-size: 0.95rem;
}
.wm-nb-count {
  font-size: 0.82rem;
  color: var(--color-text-muted);
}
.wm-nb-date {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  opacity: 0.6;
}
.wm-nb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.practice-btn {
  padding: 6px 14px !important;
  font-size: 0.85rem !important;
  background: var(--color-bg-btn-primary) !important;
  color: var(--color-text-btn-primary) !important;
}
.btn-edit {
  background: none; border: none; color: var(--color-text-muted);
  cursor: pointer; font-size: 0.9rem; padding: 4px 6px; border-radius: 4px;
  opacity: 0.5; transition: opacity 0.15s;
}
.wm-nb-card:hover .btn-edit { opacity: 1; }
.btn-edit:hover { color: var(--color-accent); background: rgba(74,144,217,0.1); }
.btn-delete {
  background: none; border: none; color: var(--color-text-muted);
  cursor: pointer; font-size: 1rem; padding: 4px 8px; border-radius: 4px;
}
.btn-delete:hover { color: #e74c3c; background: rgba(231,76,60,0.1); }
.wm-nb-rename-input {
  font-weight: 600;
  font-size: 0.95rem;
  padding: 3px 8px;
  border: 2px solid var(--color-accent);
  border-radius: 4px;
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  width: 200px;
  outline: none;
}
.toolbar-btn.back-home {
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  background-color: var(--color-bg-btn-secondary);
  color: var(--color-text-btn-secondary);
}

@media (max-width: 600px) {
  .wrong-manage-page {
    width: 100%;
    margin: 0 auto;
    padding: 16px;
    border-radius: 0;
  }
  .wm-actions { flex-wrap: wrap; }
  .wm-nb-card { flex-wrap: wrap; }
  .wm-nb-actions { flex-wrap: wrap; justify-content: flex-end; }
  .wm-nb-rename-input { width: 100%; }
}
</style>
