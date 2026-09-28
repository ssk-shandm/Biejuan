<template>
  <div class="toolbar">
    <button @click="$emit('backHome')" class="toolbar-btn back-home">← 返回首页</button>
    <!-- 做题 / 专项：清空 + 乱序 + 添加到错题 -->
    <template v-if="mode === 'practice' || mode === 'specialize'">
      <button @click="$emit('clearPractice')" class="toolbar-btn clear-wrong">重置/清空</button>
      <button @click="$emit('toggleShuffle')" class="toolbar-btn shuffle-toggle">
        {{ shuffleEnabled ? '原始顺序' : '随机顺序' }}
      </button>
      <button @click="$emit('addToWrongBook')" class="toolbar-btn add-all-wrong">添加到错题本</button>
    </template>

    <!-- 背题：仅乱序 -->
    <template v-if="mode === 'endorse'">
      <button @click="$emit('toggleShuffle')" class="toolbar-btn shuffle-toggle">
        {{ shuffleEnabled ? '原始顺序' : '随机顺序' }}
      </button>
    </template>

    <!-- 错题：重置答案 + 清空 + 导出 -->
    <template v-if="mode === 'wrong'">
      <button v-if="wrongCount > 0" @click="$emit('clearWrongAnswers')" class="toolbar-btn reset-answers">清空答案</button>
      <button v-if="wrongCount > 0" @click="$emit('clearWrong')" class="toolbar-btn clear-wrong">清空错题本</button>
      <button v-if="wrongCount > 0" @click="$emit('exportWrong')" class="toolbar-btn export">导出错题</button>
    </template>

    <!-- 考试 / 非上述模式：导出错题（有错题时显示） -->
    <button
      v-if="mode !== 'wrong' && mode !== 'endorse' && wrongCount > 0"
      @click="$emit('exportWrong')"
      class="toolbar-btn export"
    >
      导出错题
    </button>
  </div>

  <h2 v-if="mode === 'wrong' && questionCount === 0" class="no-questions-text">
    错题本是空的，请先在其他模式中添加错题。
  </h2>
  <div v-if="mode === 'wrong' && questionCount > 0 && notebookName" class="notebook-info">
    当前错题本：<strong>{{ notebookName }}</strong>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  shuffleEnabled: boolean
  mode: string
  wrongCount: number
  questionCount: number
  /** 当前活跃的错题本名称（wrong 模式显示） */
  notebookName?: string
}>()

defineEmits<{
  backHome: []
  clearPractice: []
  toggleShuffle: []
  addToWrongBook: []
  clearWrong: []
  clearWrongAnswers: []
  exportWrong: []
}>()
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 30px;
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--color-bg-container);
  border-bottom: 1px solid var(--color-border-divider);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.no-questions-text {
  text-align: center;
  color: var(--color-text-muted);
  padding: 20px;
}
.notebook-info {
  font-size: 0.82rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
  padding: 2px 0;
}
.toolbar-btn {
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.toolbar-btn.back-home {
  background-color: var(--color-bg-btn-secondary);
  color: var(--color-text-btn-secondary);
}
.toolbar-btn.back-home:hover {
  background-color: var(--color-bg-btn-secondary-hover);
}
.toolbar-btn.export {
  background-color: var(--color-bg-btn-info);
  color: var(--color-text-btn-info);
}
.toolbar-btn.export:hover {
  background-color: var(--color-bg-btn-info-hover);
}
.toolbar-btn.reset-answers {
  background-color: var(--color-bg-btn-purple);
  color: var(--color-text-btn-purple);
}
.toolbar-btn.reset-answers:hover {
  background-color: var(--color-bg-btn-purple-hover);
}
.toolbar-btn.clear-wrong {
  background-color: var(--color-bg-btn-danger);
  color: var(--color-text-btn-danger);
}
.toolbar-btn.clear-wrong:hover {
  background-color: var(--color-bg-btn-danger-hover);
}
.toolbar-btn.add-all-wrong {
  background-color: var(--color-bg-btn-warning);
  color: var(--color-text-btn-warning);
}
.toolbar-btn.add-all-wrong:hover {
  background-color: var(--color-bg-btn-warning-hover);
}
.toolbar-btn.shuffle-toggle {
  background-color: var(--color-bg-btn-purple);
  color: var(--color-text-btn-purple);
}
.toolbar-btn.shuffle-toggle:hover {
  background-color: var(--color-bg-btn-purple-hover);
}
.no-questions-text {
  text-align: center;
  color: var(--color-text-muted);
  padding: 40px;
}
</style>
