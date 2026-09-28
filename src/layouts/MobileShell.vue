<template>
  <main class="mobile-shell">
    <MobileTopBar />

    <Transition name="mobile-screen" mode="out-in">
      <div :key="screen" class="mobile-screen-frame">
    <MobileConverterView
      v-if="converterVisited"
      v-show="screen === 'converter'"
      @back="openSettings"
      @configure="openAiSettings"
      @started="openTerminal"
    />

    <section v-if="screen === 'terminal'" class="mobile-panel mobile-terminal-view">
      <button class="mobile-action" type="button" @click="openConverter">鈫?杩斿洖杞崲缁撴灉</button>
      <RuntimeTerminal />
    </section>
    <MobileHomeView
      v-else-if="screen === 'home'"
      :is-loading="isLoading"
      :all-banks="allBanks"
      :current-bank-file="currentBankFile"
      :available-question-types="availableQuestionTypes"
      :question-count="questions.length"
      :wrong-count="wrongCount"
      @bank-change="handleBankChange"
      @importBank="openBankImport"
      @start="handleStartGame"
      @start-specialize="handleStartSpecialize"
    />

    <MobileQuizView
      v-else-if="screen === 'quiz'"
      :app-mode="appMode"
      :mode-label="modeLabel"
      :render-error="renderError"
      :current-question="currentQuestion"
      :current-question-index="currentQuestionIndex"
      :total-questions="totalQuestions"
      :answer-sheet="answerSheet"
      :wrong-display-entry-ids="wrongDisplayEntryIds"
      :current-bank-file="currentBankFile"
      @answer-update="handleAnswerUpdate"
      @submit="handleSubmit"
      @compound-submit="handleCompoundSubmit"
      @sub-submit="handleSubSubmit"
      @previous="jump(currentQuestionIndex - 1)"
      @answer-sheet="showAnswerSheet = true"
      @next="jump(currentQuestionIndex + 1)"
      @submit-exam="submitExam"
      @home="goHome"
      @reset-error="resetQuizError"
    />

    <section v-else-if="screen === 'review'" class="mobile-panel mobile-mode-list">
      <h2>鑰冭瘯缁撴潫</h2>
      <p>绛斿 {{ score }} / {{ totalQuestions }} 棰</p>
      <button class="mobile-action mobile-primary" type="button" @click="goHome">杩斿洖棣栭〉</button>
    </section>

    <MobileSettingsView
      v-else-if="screen === 'settings'"
      :is-dark-mode="isDarkMode"
      :open-ai-settings="showAiSettings"
      :banks="allBanks"
      :selected-bank="currentBankFile"
      @toggle-dark="toggleDarkMode"
      @converter="openConverter"
    />

    <section v-else-if="screen === 'about'" class="mobile-panel mobile-mode-list">
      <h2>鍏充簬鍒嵎</h2>
      <p class="mobile-muted">绉诲姩绔竷灞€姝ｅ湪閫愭杩佺Щ锛岄搴撳拰绛旈鏍稿績涓庢闈㈢鍏变韩銆</p>
      <button class="mobile-action" type="button" @click="openSettings">杩斿洖璁剧疆</button>
    </section>

    <MobileWrongNotebookView
      v-else-if="screen === 'wrong-notebook'"
      :bank-name="currentBankName"
      :notebooks="currentBankNotebooks"
      :active-id="activeNotebookForBank"
      :entry-counts="notebookEntryCounts"
      :total-entry-count="currentBankTotalEntryCount"
      @import="importWrongQuestions"
      @backup-all="handleBackupAll"
      @restore-all="restoreInput?.click()"
      @start-practice="startNotebookPractice"
      @set-active="setActiveNotebook"
      @rename="renameNotebook"
      @export="exportNotebook"
      @delete="deleteNotebookById"
    />

      </div>
    </Transition>

    <MobileAnswerSheet
      :open="showAnswerSheet"
      :shuffled-questions="shuffledQuestions"
      :answer-sheet="answerSheet"
      :current-index="currentQuestionIndex"
      @close="showAnswerSheet = false"
      @jump="(index) => { jump(index); showAnswerSheet = false }"
    />

    <input ref="bankImportInput" type="file" accept=".json,application/json" hidden @change="handleExternalBankFileImport" />
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="handleFileImport" />
    <input ref="restoreInput" type="file" accept=".json,application/json" hidden @change="handleRestoreAll" />

    <div v-if="screen === 'wrong-notebook' && showImportDialog" class="mobile-dialog-overlay" @click.self="cancelImport">
      <section class="mobile-dialog" role="dialog" aria-modal="true" aria-labelledby="mobile-import-title">
        <h2 id="mobile-import-title">瀵煎叆閿欓</h2>
        <p class="mobile-muted">宸茶鍙?{{ pendingImportQuestions?.length || 0 }} 閬撻锛岃閫夋嫨瀵煎叆鏂瑰紡銆</p>
        <label class="mobile-dialog-option">
          <input v-model="importDialogChoice" type="radio" value="new" />
          <span>鍒涘缓鏂伴敊棰樻湰</span>
        </label>
        <input
          v-if="importDialogChoice === 'new'"
          v-model="importDialogNewNotebookName"
          class="mobile-select"
          type="text"
          placeholder="错题本名称"
        />
        <label class="mobile-dialog-option">
          <input v-model="importDialogChoice" type="radio" value="existing" />
          <span>瀵煎叆鍒板凡鏈夐敊棰樻湰</span>
        </label>
        <select v-if="importDialogChoice === 'existing'" v-model="importDialogTargetNotebook" class="mobile-select">
          <option value="">请选择错题本</option>
          <option v-for="notebook in currentBankNotebooks" :key="notebook.id" :value="notebook.id">
            {{ notebook.name }}（{{ notebookEntryCounts[notebook.id] || 0 }} 道）
          </option>
        </select>
        <div class="mobile-dialog-actions">
          <button class="mobile-action" type="button" @click="cancelImport">鍙栨秷</button>
          <button class="mobile-action mobile-primary" type="button" :disabled="!canConfirmImport" @click="doConfirmImport">纭瀵煎叆</button>
        </div>
      </section>
    </div>

    <MobileAppNav
      v-if="screen !== 'quiz' && screen !== 'review'"
      :screen="screen"
      @home="goHome"
      @wrong-notebook="openWrongNotebook"
      @settings="openSettings"
    />

    <ToastContainer />
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ToastContainer from '../components/ToastContainer.vue'
import MobileAnswerSheet from '../components/mobile/MobileAnswerSheet.vue'
import MobileAppNav from '../components/mobile/MobileAppNav.vue'
import MobileConverterView from '../components/mobile/MobileConverterView.vue'
import RuntimeTerminal from '../components/RuntimeTerminal.vue'
import MobileSettingsView from '../components/mobile/MobileSettingsView.vue'
import MobileHomeView from '../components/mobile/MobileHomeView.vue'
import MobileQuizView from '../components/mobile/MobileQuizView.vue'
import MobileTopBar from '../components/mobile/MobileTopBar.vue'
import MobileWrongNotebookView from '../components/mobile/MobileWrongNotebookView.vue'
import { useQuiz } from '../composables/useQuiz'
import { useDarkMode } from '../composables/useDarkMode'
import { useAppNavigation } from '../composables/useAppNavigation'
import { useAndroidBackButton } from '../composables/useAndroidBackButton'
import { useWrongNotebookActions } from '../composables/useWrongNotebookActions'
import { showToast } from '../composables/useToast'
import { useQuizStore } from '../stores/quizStore'

const quiz = useQuiz()
const { isDarkMode, toggleDarkMode } = useDarkMode()
const quizStore = useQuizStore()
const {
  isLoading, appMode, currentBankFile, allBanks, availableQuestionTypes, questions,
  shuffledQuestions, currentQuestionIndex, totalQuestions, answerSheet, wrongCount,
  wrongDisplayEntryIds, score, renderError, fileInput,
  handleBankChange, handleStartGame, handleStartSpecialize, handleBackToHome,
  handleAnswerUpdate, handleSubmit, handleCompoundSubmit, handleSubSubmit,
  handleJumpTo, submitExam, importWrongQuestions, handleFileImport,
  handleExternalBankFileImport,
  showImportDialog, importDialogNewNotebookName, pendingImportQuestions,
  confirmImportToNew, confirmImportToExisting, cancelImport,
} = quiz
const { screen, goHome, openSettings: navigateToSettings, openConverter: navigateToConverter, openTerminal, openWrongNotebook } = useAppNavigation(appMode, handleStartGame, handleBackToHome)
const converterVisited = ref(false)
const bankImportInput = ref<HTMLInputElement | null>(null)
function openBankImport() {
  // Android WebView's file input preserves the provider's display name.
  // The native dialog may expose a content URI document id instead.
  bankImportInput.value?.click()
}
function openConverter() { converterVisited.value = true; navigateToConverter() }
const goBack = () => {
  if (showImportDialog.value) { cancelImport(); return }
  if (showAnswerSheet.value) { showAnswerSheet.value = false; return }
  if (screen.value === 'terminal') { openConverter(); return }
  if (screen.value === 'converter') { openSettings(); return }
  if (screen.value !== 'home') goHome()
}
useAndroidBackButton(goBack)
const {
  deleteNotebookById, exportNotebook, handleBackupAll, handleRestoreAll,
} = useWrongNotebookActions(questions)

const currentQuestion = computed(() => shuffledQuestions.value[currentQuestionIndex.value])
const modeLabel = computed(() => ({ practice: '鍋氶缁冧範', exam: '妯℃嫙鑰冭瘯', endorse: '鑳岄妯″紡', wrong: '閿欓缁冧範', specialize: '涓撻」缁冧範' })[appMode.value as 'practice' | 'exam' | 'endorse' | 'wrong' | 'specialize'] || '')
const currentBankNotebooks = computed(() => quizStore.getNotebooksByBank(currentBankFile.value))
const activeNotebookForBank = computed(() => quizStore.getActiveNotebook(currentBankFile.value)?.id)
const currentBankName = computed(() => allBanks.value.find((bank) => bank.file === currentBankFile.value)?.name || currentBankFile.value)
const notebookEntryCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const notebook of currentBankNotebooks.value) {
    counts[notebook.id] = quizStore.getEntriesByNotebook(notebook.id).length
  }
  return counts
})
const currentBankTotalEntryCount = computed(() => Object.values(notebookEntryCounts.value).reduce((sum, count) => sum + count, 0))
const restoreInput = ref<HTMLInputElement | null>(null)
const showAnswerSheet = ref(false)
const importDialogChoice = ref<'new' | 'existing'>('new')
const importDialogTargetNotebook = ref('')
const canConfirmImport = computed(() => {
  if (!pendingImportQuestions.value) return false
  return importDialogChoice.value === 'new'
    ? importDialogNewNotebookName.value.trim().length > 0
    : importDialogTargetNotebook.value.length > 0
})

const showAiSettings = ref(false)

function openSettings() {
  showAiSettings.value = false
  navigateToSettings()
}

function openAiSettings() {
  showAiSettings.value = true
  navigateToSettings()
}

function jump(index: number) {
  if (index < 0 || index >= totalQuestions.value) return
  void handleJumpTo(index, isDarkMode.value)
  void nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

function resetQuizError() {
  renderError.value = ''
  goHome()
}

function startNotebookPractice(notebookId: string) {
  quizStore.setActiveNotebook(currentBankFile.value, notebookId)
  handleStartGame('wrong')
}

function setActiveNotebook(notebookId: string) {
  quizStore.setActiveNotebook(currentBankFile.value, notebookId)
  void showToast('宸插垏鎹㈠綋鍓嶉敊棰樻湰')
}

function renameNotebook(notebookId: string) {
  const notebook = quizStore.notebooks.find((item) => item.id === notebookId)
  if (!notebook) return
  const nextName = window.prompt('璇疯緭鍏ユ柊鐨勯敊棰樻湰鍚嶇О', notebook.name)?.trim()
  if (!nextName || nextName === notebook.name) return
  quizStore.renameNotebook(notebookId, nextName)
  void showToast('閿欓鏈悕绉板凡鏇存柊')
}

function doConfirmImport() {
  if (!canConfirmImport.value) return
  if (importDialogChoice.value === 'new') confirmImportToNew()
  else confirmImportToExisting(importDialogTargetNotebook.value)
  importDialogChoice.value = 'new'
  importDialogTargetNotebook.value = ''
}

watch(screen, () => {
  showAnswerSheet.value = false
  if (screen.value !== 'wrong-notebook') {
    importDialogChoice.value = 'new'
    importDialogTargetNotebook.value = ''
  }
})
</script>
