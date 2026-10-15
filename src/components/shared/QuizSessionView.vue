<template>
  <div ref="quizRoot" class="quiz-layout" :data-presentation="presentation">
    <div v-if="renderError">
      <ErrorView :message="renderError" @reset="emit('resetError')" />
    </div>
    <template v-else>
      <div class="quiz-sidebar">
        <AnswerCard
          :key="presentation"
          :default-expanded="true"
          :default-pinned="presentation === 'single'"
          :always-visible="presentation === 'single'"
          :questions="shuffledQuestions"
          :answer-sheet="answerSheet"
          :current-index="currentQuestionIndex"
          :app-mode="appMode"
          :bank-file="currentBankFile"
          :wrong-entry-ids="wrongDisplayEntryIds"
          @jumpTo="jump"
          @clearAllWrong="emit('clearWrong')"
        />
      </div>
      <div class="quiz-container quiz-main-area">
        <header class="quiz-session-header">
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
          <div class="quiz-presentation-bar">
            <span class="quiz-position" aria-live="polite">{{ totalQuestions ? currentQuestionIndex + 1 : 0 }} / {{ totalQuestions }} 题</span>
          </div>
        </header>
        <p v-if="!totalQuestions" class="no-questions-text">当前没有可练习的题目。</p>
        <div
          v-for="{ question, index } in displayedQuestions"
          :key="`${question.number}-${wrongDisplayEntryIds[index] ?? index}`"
          :id="'q-' + question.number"
          :data-question-index="index"
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
            :sub-drafts="answerSheet.get(question.number)?.subDrafts"
            @sub-answer-update="(subId: number, answer: string) => emit('subAnswerUpdate', question, subId, answer)"
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
        <nav v-if="presentation === 'single' && totalQuestions" class="quiz-page-nav" aria-label="题目导航">
          <button type="button" :disabled="currentQuestionIndex <= 0" @click="jump(currentQuestionIndex - 1)">上一题</button>
          <span>{{ currentQuestionIndex + 1 }} / {{ totalQuestions }}</span>
          <button type="button" :disabled="currentQuestionIndex >= totalQuestions - 1" @click="jump(currentQuestionIndex + 1)">下一题</button>
        </nav>
        <div v-if="appMode === 'exam'" class="list-nav">
          <button class="submit-exam-btn" type="button" @click="emit('submitExam')">提交试卷</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import type { AppMode, Question, SubAnswer, UserAnswer } from '../../types'
import type { AnswerSheetEntry } from '../../composables/useQuiz'
import AnswerCard from '../AnswerCard.vue'
import QuestionDisplay from '../QuestionDisplay.vue'
import QuizToolbar from '../QuizToolbar.vue'
import ErrorView from './ErrorView.vue'
import { useQuizPresentation } from '../../composables/useQuizPresentation'
import { useDesktopQuizViewport } from '../../composables/useDesktopQuizViewport'
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
  (event: 'subAnswerUpdate', question: Question, subId: number, answer: string): void
  (event: 'submitExam'): void
}>()

const { presentation } = useQuizPresentation()
const quizRoot = ref<HTMLElement | null>(null)
const { jump } = useDesktopQuizViewport({
  root: quizRoot,
  presentation,
  questions: toRef(props, 'shuffledQuestions'),
  currentIndex: toRef(props, 'currentQuestionIndex'),
  select: index => emit('jumpTo', index),
})
const displayedQuestions = computed(() => {
  if (presentation.value === 'single') {
    const question = props.shuffledQuestions[props.currentQuestionIndex]
    return question ? [{ question, index: props.currentQuestionIndex }] : []
  }
  return props.shuffledQuestions.map((question, index) => ({ question, index }))
})

const AFTER_WINDOW = 4
// Keep already-mounted questions in the scroll flow. Removing them while the
// user is scrolling changes the document height above the viewport and makes
// the browser fight the answer-card position tracking.
const windowStart = computed(() => presentation.value === 'single' ? props.currentQuestionIndex : 0)
const windowEnd = computed(() => Math.min(props.shuffledQuestions.length - 1, props.currentQuestionIndex + AFTER_WINDOW))
</script>

<style>
.quiz-layout { display:flex; gap:24px; width:90%; max-width:1200px; margin:20px auto; align-items:start }
.quiz-layout[data-presentation="single"] { width:calc(100% - 40px) !important; max-width:1440px !important; min-height:calc(100vh - 40px); align-items:stretch; }
.quiz-sidebar { flex:0 0 auto; position:sticky; top:20px; max-height:calc(100vh - 40px); overflow-y:auto; border-radius:12px }
.quiz-layout[data-presentation="single"] .quiz-sidebar { position:sticky; top:20px; align-self:flex-start; max-height:calc(100vh - 40px); }
.quiz-main-area { flex:1; max-width:800px; margin:0 auto; background-color:var(--color-bg-container); border-radius:12px; box-shadow:var(--color-shadow-container); border:1px solid var(--color-border-container); box-sizing:border-box; color:var(--color-text-primary); padding:0; contain:layout style }
.quiz-layout[data-presentation="single"] .quiz-main-area { max-width:none; width:100%; min-height:calc(100vh - 40px); margin:0; }
.no-questions-text { text-align:center; color:var(--color-text-muted); padding:40px }
.list-nav { margin-top:30px; padding-top:20px; border-top:1px solid var(--color-border-divider) }
.submit-exam-btn { width:100%; padding:14px; font-size:1.1rem; font-weight:bold; color:var(--color-text-btn-success); background:var(--color-bg-btn-success); border:none; border-radius:8px; cursor:pointer }
.question-list-item { margin-bottom:20px; padding-bottom:20px; border-bottom:1px solid var(--color-border-divider); scroll-margin-top:20px }
.quiz-layout[data-presentation="single"] .question-list-item { margin-bottom:0; padding-bottom:0; border-bottom:0; }
.question-placeholder { padding:16px 0; color:var(--color-text-muted); line-height:1.6; min-height:60px }
.question-placeholder .placeholder-idx { font-weight:600; margin-right:8px; color:var(--color-text-secondary) }
.question-placeholder .placeholder-type { font-size:.8rem; background:var(--color-bg-tag); color:var(--color-text-tag); padding:2px 6px; border-radius:4px; margin-right:8px }
.question-placeholder .placeholder-text { display:block; margin-top:4px; font-size:.95rem; white-space:pre-wrap; word-break:break-word; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical }
.quiz-main-area > :not(.toolbar) { padding-left:30px; padding-right:30px }
.quiz-main-area > .toolbar + * { padding-top:30px }
.quiz-main-area { min-width: 0; overflow-anchor: none; }
.quiz-session-header { position: sticky; top: 0; z-index: 10; padding-left: 0 !important; padding-right: 0 !important; margin-bottom: 24px; background: var(--color-bg-container); border-radius: 12px 12px 0 0; }
.quiz-session-header > .toolbar { position: static; }
.quiz-presentation-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 30px; border-bottom: 1px solid var(--color-border-divider); }
.quiz-position { color: var(--color-text-muted); font-size: .86rem; font-variant-numeric: tabular-nums; }
.quiz-page-nav { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; padding-bottom: 14px; background: var(--color-bg-container); border-top: 1px solid var(--color-border-divider); z-index: 9; }
.quiz-page-nav button { border: 1px solid var(--color-border-divider); background: var(--color-bg-btn-secondary); color: var(--color-text-btn-secondary); padding: 10px 22px; border-radius: 8px; font: inherit; cursor: pointer; }
.quiz-page-nav button:disabled { opacity: .45; cursor: not-allowed; }
.quiz-page-nav button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.quiz-page-nav span { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
@media (max-width:768px) {
  .quiz-layout { flex-direction:column; width:100%; margin:0 auto; gap:12px }
  .quiz-layout[data-presentation="single"] { width:100%; min-height:0; }
  .quiz-sidebar { position:static; max-height:none; width:100%; margin-bottom:0 }
  .quiz-main-area { max-width:100%; margin:0; border-radius:0 }
  .quiz-layout[data-presentation="single"] .quiz-main-area { min-height:0; }
  .quiz-main-area > :not(.toolbar) { padding-left:16px; padding-right:16px }
  .quiz-presentation-bar { padding-left: 16px; padding-right: 16px; }
}
</style>
