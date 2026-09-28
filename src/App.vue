<template>
  <Transition name="page-fade" mode="out-in">
    <LoadingView v-if="isLoading" key="loading" />
    <AppScreenHost
      v-else
      :app-mode="appMode"
      :all-banks="allBanks"
      :current-bank-file="currentBankFile"
      :available-question-types="availableQuestionTypes"
      :current-bank-notebooks="currentBankNotebooks"
      :active-notebook-for-bank="activeNotebookForBank"
      :active-notebook-for-bank-obj="activeNotebookForBankObj"
      :current-bank-name="currentBankName"
      :wrong-count="wrongCount"
      :notebook-entry-counts="notebookEntryCounts"
      :render-error="renderError"
      :shuffled-questions="shuffledQuestions"
      :answer-sheet="answerSheet"
      :current-question-index="currentQuestionIndex"
      :total-questions="totalQuestions"
      :score="score"
      :wrong-display-entry-ids="wrongDisplayEntryIds"
      :shuffle-enabled="shuffleEnabled"
      :active-notebook-name="activeNotebookName"
      @start="handleStartGame"
      @start-specialize="handleStartSpecialize"
      @change-bank="handleBankChange"
      @back-home="handleBackToHome"
      @back-settings="handleBackToSettings"
      @import-wrong="importWrongQuestions"
      @export-wrong="exportWrongQuestions"
      @set-active-notebook="(id: string) => quizStore.setActiveNotebook(currentBankFile, id)"
      @start-practice="(id: string) => { quizStore.setActiveNotebook(currentBankFile, id); handleStartGame('wrong'); }"
      @delete-notebook="deleteNotebookById"
      @rename-notebook="(id: string, name: string) => quizStore.renameNotebook(id, name)"
      @backup-all="handleBackupAll"
      @restore-all="handleRestoreAll"
      @reset-error="() => { renderError = ''; appMode = 'start' }"
      @jump-to="(idx: number) => handleJumpTo(idx, isDarkMode)"
      @clear-wrong="handleClearWrong"
      @clear-practice="handleClearPractice"
      @toggle-shuffle="handleToggleShuffle"
      @add-to-wrong-book="handleAddToWrongBook"
      @clear-wrong-answers="handleClearWrongAnswers"
      @answer-update="(answer, question) => handleAnswerUpdate(answer, question)"
      @submit="handleSubmit"
      @compound-submit="handleCompoundSubmit"
      @sub-submit="handleSubSubmit"
      @submit-exam="submitExam"
    />
  </Transition>

  <template v-if="appMode === 'start' || appMode === 'wrong-manage'">
    <input ref="fileInput" type="file" accept=".json" style="display:none" @change="handleFileImport" />
    <div v-if="showImportDialog" class="import-dialog-overlay" @click.self="doConfirmImport">
      <div class="import-dialog">
        <h3>导入错题</h3>
        <p>发现 {{ pendingImportQuestions?.length || 0 }} 道错题，请选择导入方式：</p>
        <div class="import-option">
          <label><input v-model="importDialogChoice" type="radio" value="new" /> 新建错题本：</label>
          <input v-if="importDialogChoice === 'new'" v-model="importDialogNewNotebookName" type="text" class="import-nb-name" placeholder="请输入错题本名称" />
        </div>
        <div class="import-option">
          <label><input v-model="importDialogChoice" type="radio" value="existing" /> 导入到已有错题本：</label>
          <select v-if="importDialogChoice === 'existing'" v-model="importDialogTargetNotebook" class="import-nb-select">
            <option v-for="nb in currentBankNotebooks" :key="nb.id" :value="nb.id">{{ nb.name }} ({{ getNotebookEntryCount(nb.id) }} 题)</option>
          </select>
          <span v-if="importDialogChoice === 'existing' && currentBankNotebooks.length === 0" class="no-notebook-hint">当前题库还没有错题本，请先新建一个。</span>
        </div>
        <div class="import-dialog-actions">
          <button class="toolbar-btn cancel" type="button" @click="cancelImport">取消</button>
          <button class="toolbar-btn import" type="button" :disabled="!canConfirmImport" @click="doConfirmImport">确认导入</button>
        </div>
      </div>
    </div>
  </template>
  <ToastContainer />
  <UpdateDialog />
</template>
<script setup lang="ts">
import { onErrorCaptured, onMounted, ref, computed } from 'vue'
import AppScreenHost from './components/shared/AppScreenHost.vue'
import ToastContainer from './components/ToastContainer.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import LoadingView from './components/shared/LoadingView.vue'
import { useDarkMode } from './composables/useDarkMode'
import { useQuiz } from './composables/useQuiz'
import { useQuizStore } from './stores/quizStore'
import { useWrongNotebookActions } from './composables/useWrongNotebookActions'
import { useVersion } from './composables/useVersion'
import { useUpdatePreferences } from './composables/useUpdatePreferences'

const { isDarkMode } = useDarkMode()
const { checkUpdate } = useVersion()
const { autoCheckUpdates } = useUpdatePreferences()
onMounted(() => {
  if (autoCheckUpdates.value) {
    void checkUpdate()
  }
})

const q = useQuiz()
const quizStore = useQuizStore()

// destructure everything used in template
const {
  isLoading, appMode, currentBankFile, availableQuestionTypes, renderError, questions,
  shuffledQuestions, answerSheet, currentQuestionIndex, totalQuestions, score,
  wrongCount, wrongDisplayEntryIds, fileInput, shuffleEnabled,
  handleStartGame, handleStartSpecialize, handleBankChange, handleBackToHome,
  handleAnswerUpdate, handleSubmit, handleCompoundSubmit, handleSubSubmit,
  handleToggleShuffle, handleClearPractice, handleAddToWrongBook, handleClearWrong,
  handleJumpTo, submitExam, exportWrongQuestions, importWrongQuestions, handleFileImport,
  allBanks,
  showImportDialog, importDialogNewNotebookName, pendingImportQuestions,
  confirmImportToNew, confirmImportToExisting, cancelImport,
  handleClearWrongAnswers,
} = q


function handleBackToSettings() {
  if (window.history.state?.mode === 'about') {
    window.history.back()
  } else {
    appMode.value = 'settings'
  }
}

// ── 导入对话框 ──
const importDialogChoice = ref<'new' | 'existing'>('new')
const importDialogTargetNotebook = ref<string>('')

const currentBankNotebooks = computed(() => quizStore.getNotebooksByBank(currentBankFile.value))

function getNotebookEntryCount(notebookId: string) {
  return quizStore.getEntriesByNotebook(notebookId).length
}

const notebookEntryCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const nb of currentBankNotebooks.value) {
    counts[nb.id] = getNotebookEntryCount(nb.id)
  }
  return counts
})

const canConfirmImport = computed(() => {
  if (!pendingImportQuestions.value) return false
  if (importDialogChoice.value === 'new') {
    return importDialogNewNotebookName.value.trim().length > 0
  }
  return importDialogTargetNotebook.value.length > 0
})

function doConfirmImport() {
  if (!canConfirmImport.value) { cancelImport(); return }
  if (importDialogChoice.value === 'new') {
    confirmImportToNew()
  } else {
    confirmImportToExisting(importDialogTargetNotebook.value)
  }
  importDialogChoice.value = 'new'
  importDialogTargetNotebook.value = ''
}

/** 当前活跃错题本名称（用于 wrong 模式 Toolbar 显示） */
const activeNotebookName = computed(() => {
  const nb = quizStore.getActiveNotebook(currentBankFile.value)
  return nb?.name || undefined
})

/** 当前活跃错题本 id */
const activeNotebookForBank = computed(() => quizStore.getActiveNotebook(currentBankFile.value)?.id)

/** 当前活跃错题本对象 */
const activeNotebookForBankObj = computed(() => quizStore.getActiveNotebook(currentBankFile.value) ?? null)

/** 当前题库名称 */
const currentBankName = computed(() => {
  return allBanks.value.find(b => b.file === currentBankFile.value)?.name || currentBankFile.value
})

const { deleteNotebookById, handleBackupAll, handleRestoreAll } = useWrongNotebookActions(questions)

onErrorCaptured((err) => { console.error('[渲染错误]', err, err?.stack); renderError.value = String(err) + (err?.stack ? '\n' + err.stack : ''); return false })
</script>

<style scoped>
.quiz-layout { display:flex; gap:24px; width:90%; max-width:1200px; margin:20px auto; align-items:start }
.quiz-sidebar { flex:0 0 auto; position:sticky; top:20px; max-height:calc(100vh - 40px); overflow-y:auto; border-radius:12px }
.quiz-main-area { flex:1; max-width:800px; margin:0 auto; background-color:var(--color-bg-container); border-radius:12px; box-shadow:var(--color-shadow-container); border:1px solid var(--color-border-container); box-sizing:border-box; color:var(--color-text-primary); padding:0; contain:layout style }
.quiz-container-loading { background-color:var(--color-bg-container); border-radius:12px; box-shadow:var(--color-shadow-container); border:1px solid var(--color-border-container); padding:40px 30px; box-sizing:border-box; width:90%; max-width:500px; margin:auto; color:var(--color-text-primary); display:flex; flex-direction:column; align-items:center; justify-content:center }
.quiz-container-start { background-color:var(--color-bg-container); border-radius:12px; box-shadow:var(--color-shadow-container); border:1px solid var(--color-border-container); padding:40px 30px; width:90%; max-width:500px; margin:auto }
.no-questions-text { text-align:center; color:var(--color-text-muted); padding:40px }
.list-nav { margin-top:30px; padding-top:20px; border-top:1px solid var(--color-border-divider) }
.submit-exam-btn { width:100%; padding:14px; font-size:1.1rem; font-weight:bold; color:var(--color-text-btn-success); background:var(--color-bg-btn-success); border:none; border-radius:8px; cursor:pointer }
.question-list-item { margin-bottom:20px; padding-bottom:20px; border-bottom:1px solid var(--color-border-divider); scroll-margin-top:20px }

/* 非窗口题目的轻量占位（只显示纯文本，无组件开销） */
.question-placeholder {
  padding: 16px 0;
  color: var(--color-text-muted);
  line-height: 1.6;
  min-height: 60px;
}
.question-placeholder .placeholder-idx {
  font-weight: 600;
  margin-right: 8px;
  color: var(--color-text-secondary);
}
.question-placeholder .placeholder-type {
  font-size: 0.8rem;
  background: var(--color-bg-tag);
  color: var(--color-text-tag);
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 8px;
}
.question-placeholder .placeholder-text {
  display: block;
  margin-top: 4px;
  font-size: 0.95rem;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

/* 导入对话框 */
.import-dialog-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.import-dialog {
  background: var(--color-bg-container); border-radius: 12px; padding: 24px;
  max-width: 420px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  /* Ensure it's vertically centered */
  margin: auto;
}
.import-dialog h3 { margin: 0 0 12px; font-size: 1.1rem; }
.import-dialog p { margin: 0 0 16px; font-size: 0.9rem; color: var(--color-text-muted); }
.import-option { margin-bottom: 12px; }
.import-option label { font-size: 0.9rem; cursor: pointer; }
.import-nb-name, .import-nb-select { margin-top: 6px; width: 100%; padding: 8px; font-size: 0.9rem; border: 1px solid var(--color-border-input); border-radius: 6px; box-sizing: border-box; }
.import-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.toolbar-btn.cancel { background: var(--color-bg-input-disabled); color: var(--color-text-muted); padding: 6px 14px; font-size: 0.82rem; border: none; border-radius: 5px; cursor: pointer; }
.no-notebook-hint { font-size: 0.8rem; color: var(--color-text-muted); margin-top: 4px; display: block; }
.quiz-main-area > :not(.toolbar) { padding-left:30px; padding-right:30px }
.quiz-main-area > .toolbar + * { padding-top:30px }
:global(body) { background-color:var(--color-bg-page); color:var(--color-text-primary); margin:0; padding:0; font-family:'Helvetica Neue',Helvetica,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif; transition:background-color .3s,color .3s }
:global(#app) { min-height:100vh; display:flex; align-items:center; justify-content:center }
@media (max-width:768px) {
  .quiz-layout { flex-direction:column; width:100%; margin:0 auto; gap:12px }
  .quiz-sidebar { position:static; max-height:none; width:100%; margin-bottom:0 }
  .quiz-main-area { max-width:100%; margin:0; border-radius:0 }
  .quiz-main-area > :not(.toolbar) { padding-left:16px; padding-right:16px }
  .quiz-container-loading, .quiz-container-start { width:100%; padding:24px 16px }
}
</style>

<style>
/* 页面切换动画（需全局作用域） */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
