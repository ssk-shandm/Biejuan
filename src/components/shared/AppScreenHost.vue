<template>
  <StartScreen
    v-if="appMode === 'start'"
    key="start"
    :banks="allBanks"
    :selected-bank="currentBankFile"
    :question-types="availableQuestionTypes"
    :is-refreshing-banks="isRefreshingBanks"
    class="quiz-container-start"
    @start="(mode) => emit('start', mode)"
    @start-specialize="emit('startSpecialize', $event)"
    @changeBank="emit('changeBank', $event)"
    @refresh-banks="emit('refreshBanks')"
  />

  <SettingsPage v-else-if="appMode === 'settings'" key="settings" :banks="allBanks" :selected-bank="currentBankFile" :is-refreshing-banks="isRefreshingBanks" @back="emit('backHome')" @refresh-banks="emit('refreshBanks')" />

  <AboutPage v-else-if="appMode === 'about'" key="about" @back="emit('backSettings')" />

  <WrongNotebookManager
    v-else-if="appMode === 'wrong-manage'"
    key="wrong-manage"
    :notebooks="currentBankNotebooks"
    :active-id="activeNotebookForBank"
    :active-notebook="activeNotebookForBankObj"
    :bank-name="currentBankName"
    :total-entry-count="wrongCount"
    :entry-counts="notebookEntryCounts"
    @back="emit('backHome')"
    @import="emit('importWrong')"
    @export="emit('exportWrong')"
    @set-active="emit('setActiveNotebook', $event)"
    @start-practice="emit('startPractice', $event)"
    @delete="emit('deleteNotebook', $event)"
    @rename="(id: string, name: string) => emit('renameNotebook', id, name)"
    @backup-all="emit('backupAll')"
    @restore-all="emit('restoreAll', $event)"
  />

  <QuizSessionView
    v-else-if="quizModes.includes(appMode)"
    key="quiz"
    :app-mode="appMode"
    :render-error="renderError"
    :shuffled-questions="shuffledQuestions"
    :answer-sheet="answerSheet"
    :current-question-index="currentQuestionIndex"
    :total-questions="totalQuestions"
    :current-bank-file="currentBankFile"
    :wrong-display-entry-ids="wrongDisplayEntryIds"
    :shuffle-enabled="shuffleEnabled"
    :wrong-count="wrongCount"
    :active-notebook-name="activeNotebookName"
    @reset-error="emit('resetError')"
    @jump-to="emit('jumpTo', $event)"
    @clear-wrong="emit('clearWrong')"
    @back-home="emit('backHome')"
    @clear-practice="emit('clearPractice')"
    @toggle-shuffle="emit('toggleShuffle')"
    @add-to-wrong-book="emit('addToWrongBook')"
    @clear-wrong-answers="emit('clearWrongAnswers')"
    @export-wrong="emit('exportWrong')"
    @answer-update="(answer, question) => emit('answerUpdate', answer, question)"
    @submit="emit('submit', $event)"
    @compound-submit="(question, answers) => emit('compoundSubmit', question, answers)"
    @sub-submit="(question, subId, answer) => emit('subSubmit', question, subId, answer)"
    @submit-exam="emit('submitExam')"
  />

  <ExamReview
    v-else-if="appMode === 'review'"
    key="review"
    :questions="shuffledQuestions"
    :answer-sheet="answerSheet"
    :score="score"
    @restart="emit('backHome')"
  />
</template>

<script setup lang="ts">
import type { AppMode, Question, SubAnswer, UserAnswer, WrongNotebook } from '../../types'
import type { BankEntry, AnswerSheetEntry } from '../../composables/useQuiz'
import StartScreen from '../StartScreen.vue'
import SettingsPage from '../SettingsPage.vue'
import AboutPage from '../AboutPage.vue'
import WrongNotebookManager from '../WrongNotebookManager.vue'
import ExamReview from '../ExamReview.vue'
import QuizSessionView from './QuizSessionView.vue'

defineProps<{
  appMode: AppMode
  allBanks: BankEntry[]
  isRefreshingBanks: boolean
  currentBankFile: string
  availableQuestionTypes: string[]
  currentBankNotebooks: WrongNotebook[]
  activeNotebookForBank?: string
  activeNotebookForBankObj: WrongNotebook | null
  currentBankName: string
  wrongCount: number
  notebookEntryCounts: Record<string, number>
  renderError: string
  shuffledQuestions: Question[]
  answerSheet: Map<number, AnswerSheetEntry>
  currentQuestionIndex: number
  totalQuestions: number
  score: number
  wrongDisplayEntryIds: number[]
  shuffleEnabled: boolean
  activeNotebookName?: string
}>()

const quizModes: AppMode[] = ['practice', 'exam', 'endorse', 'wrong', 'specialize']

const emit = defineEmits<{
  (event: 'start', mode: AppMode): void
  (event: 'startSpecialize', types: string[]): void
  (event: 'changeBank', fileName: string): void
  (event: 'backHome'): void
  (event: 'backSettings'): void
  (event: 'refreshBanks'): void
  (event: 'importWrong'): void
  (event: 'exportWrong'): void
  (event: 'setActiveNotebook', id: string): void
  (event: 'startPractice', id: string): void
  (event: 'deleteNotebook', id: string): void
  (event: 'renameNotebook', id: string, name: string): void
  (event: 'backupAll'): void
  (event: 'restoreAll', fileEvent: Event): void
  (event: 'resetError'): void
  (event: 'jumpTo', index: number): void
  (event: 'clearWrong'): void
  (event: 'clearPractice'): void
  (event: 'toggleShuffle'): void
  (event: 'addToWrongBook'): void
  (event: 'clearWrongAnswers'): void
  (event: 'answerUpdate', answer: UserAnswer, question: Question): void
  (event: 'submit', question: Question): void
  (event: 'compoundSubmit', question: Question, answers: Map<number, SubAnswer>): void
  (event: 'subSubmit', question: Question, subId: number, answer: string): void
  (event: 'submitExam'): void
}>()
</script>
