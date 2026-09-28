<template>
  <div class="quiz-layout">
    <div v-if="renderError">
      <ErrorView :message="renderError" @reset="emit('resetError')" />
    </div>
    <template v-else>
      <div class="quiz-sidebar">
        <AnswerCard
          :questions="shuffledQuestions"
          :answer-sheet="answerSheet"
          :current-index="currentQuestionIndex"
          :app-mode="appMode"
          :bank-file="currentBankFile"
          @jumpTo="(idx: number) => emit('jumpTo', idx)"
          @clearAllWrong="emit('clearWrong')"
        />
      </div>
      <div class="quiz-container quiz-main-area">
        <QuizToolbar
          :shuffle-enabled="shuffleEnabled"
          :mode="appMode"
          :wrong-count="wrongCount"
          :question-count="shuffledQuestions.length"
          :notebook-name="activeNotebookName"
          @backHome="emit('backHome')"
          @clearPractice="emit('clearPractice')"
          @toggleShuffle="emit('toggleShuffle')"
          @addToWrongBook="emit('addToWrongBook')"
          @clearWrong="emit('clearWrong')"
          @clearWrongAnswers="emit('clearWrongAnswers')"
          @exportWrong="emit('exportWrong')"
        />
        <div
          v-for="(question, index) in shuffledQuestions"
          :key="question.number"
          :id="'q-' + question.number"
          class="question-list-item"
        >
          <QuestionDisplay
            v-if="index >= windowStart && index <= windowEnd"
            :question="question"
            :question-number="index + 1"
            :total-questions="totalQuestions"
            :model-value="answerSheet.get(question.number)?.userAnswer ?? null"
            @update:modelValue="emit('answerUpdate', $event, question)"
            @submit="emit('submit', question)"
            @compound-submit="emit('compoundSubmit', question, $event)"
            @compound-submit-sub="(subId: number, ua: string) => emit('subSubmit', question, subId, ua)"
            :show-result="answerSheet.get(question.number)?.showResult || false"
            :disabled="appMode === 'endorse'"
            :is-correct="answerSheet.get(question.number)?.isCorrect ?? false"
            :sub-results="answerSheet.get(question.number)?.subAnswers"
            :app-mode="appMode"
            :bank-file="currentBankFile"
            :wrong-entry-id="wrongDisplayEntryIds[index] ?? 0"
          />
          <div v-else class="question-placeholder">
            <span class="placeholder-idx">{{ index + 1 }}.</span>
            <span class="placeholder-type">{{ question.type }}</span>
            <span class="placeholder-text">{{ question.question }}</span>
          </div>
        </div>
        <div v-if="appMode === 'exam'" class="list-nav">
          <button class="submit-exam-btn" type="button" @click="emit('submitExam')">提交试卷</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AppMode, Question, SubAnswer, UserAnswer } from '../../types'
import type { AnswerSheetEntry } from '../../composables/useQuiz'
import AnswerCard from '../AnswerCard.vue'
import QuestionDisplay from '../QuestionDisplay.vue'
import QuizToolbar from '../QuizToolbar.vue'
import ErrorView from './ErrorView.vue'

const props = defineProps<{
  appMode: AppMode
  renderError: string
  shuffledQuestions: Question[]
  answerSheet: Map<number, AnswerSheetEntry>
  currentQuestionIndex: number
  totalQuestions: number
  currentBankFile: string
  wrongDisplayEntryIds: number[]
  shuffleEnabled: boolean
  wrongCount: number
  activeNotebookName?: string
}>()

const emit = defineEmits<{
  (event: 'resetError'): void
  (event: 'jumpTo', index: number): void
  (event: 'clearWrong'): void
  (event: 'backHome'): void
  (event: 'clearPractice'): void
  (event: 'toggleShuffle'): void
  (event: 'addToWrongBook'): void
  (event: 'clearWrongAnswers'): void
  (event: 'exportWrong'): void
  (event: 'answerUpdate', answer: UserAnswer, question: Question): void
  (event: 'submit', question: Question): void
  (event: 'compoundSubmit', question: Question, answers: Map<number, SubAnswer>): void
  (event: 'subSubmit', question: Question, subId: number, answer: string): void
  (event: 'submitExam'): void
}>()

const BEFORE_WINDOW = 2
const AFTER_WINDOW = 4
const windowStart = computed(() => Math.max(0, props.currentQuestionIndex - BEFORE_WINDOW))
const windowEnd = computed(() => Math.min(props.shuffledQuestions.length - 1, props.currentQuestionIndex + AFTER_WINDOW))
</script>

<style>
.quiz-layout { display:flex; gap:24px; width:90%; max-width:1200px; margin:20px auto; align-items:start }
.quiz-sidebar { flex:0 0 auto; position:sticky; top:20px; max-height:calc(100vh - 40px); overflow-y:auto; border-radius:12px }
.quiz-main-area { flex:1; max-width:800px; margin:0 auto; background-color:var(--color-bg-container); border-radius:12px; box-shadow:var(--color-shadow-container); border:1px solid var(--color-border-container); box-sizing:border-box; color:var(--color-text-primary); padding:0; contain:layout style }
.no-questions-text { text-align:center; color:var(--color-text-muted); padding:40px }
.list-nav { margin-top:30px; padding-top:20px; border-top:1px solid var(--color-border-divider) }
.submit-exam-btn { width:100%; padding:14px; font-size:1.1rem; font-weight:bold; color:var(--color-text-btn-success); background:var(--color-bg-btn-success); border:none; border-radius:8px; cursor:pointer }
.question-list-item { margin-bottom:20px; padding-bottom:20px; border-bottom:1px solid var(--color-border-divider); scroll-margin-top:20px }
.question-placeholder { padding:16px 0; color:var(--color-text-muted); line-height:1.6; min-height:60px }
.question-placeholder .placeholder-idx { font-weight:600; margin-right:8px; color:var(--color-text-secondary) }
.question-placeholder .placeholder-type { font-size:.8rem; background:var(--color-bg-tag); color:var(--color-text-tag); padding:2px 6px; border-radius:4px; margin-right:8px }
.question-placeholder .placeholder-text { display:block; margin-top:4px; font-size:.95rem; white-space:pre-wrap; word-break:break-word; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical }
.quiz-main-area > :not(.toolbar) { padding-left:30px; padding-right:30px }
.quiz-main-area > .toolbar + * { padding-top:30px }
@media (max-width:768px) {
  .quiz-layout { flex-direction:column; width:100%; margin:0 auto; gap:12px }
  .quiz-sidebar { position:static; max-height:none; width:100%; margin-bottom:0 }
  .quiz-main-area { max-width:100%; margin:0; border-radius:0 }
  .quiz-main-area > :not(.toolbar) { padding-left:16px; padding-right:16px }
}
</style>
