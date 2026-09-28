<template>
  <template v-if="renderError">
    <section class="mobile-panel" role="alert">
      <h2>渲染错误</h2>
      <pre class="mobile-error-detail">{{ renderError }}</pre>
      <button class="mobile-action mobile-primary" type="button" @click="$emit('resetError')">返回首页</button>
    </section>
  </template>
  <template v-else-if="currentQuestion">
    <div class="mobile-panel mobile-quiz-header">
      <strong>第 {{ currentQuestionIndex + 1 }} / {{ totalQuestions }} 题</strong>
      <span class="mobile-muted">{{ modeLabel }}</span>
    </div>
    <article :id="'q-' + currentQuestion.number" class="mobile-panel mobile-question question-list-item">
      <QuestionDisplay
        :key="currentQuestion.number"
        :question="currentQuestion"
        :question-number="currentQuestionIndex + 1"
        :total-questions="totalQuestions"
        :model-value="answerSheet.get(currentQuestion.number)?.userAnswer ?? null"
        :show-result="answerSheet.get(currentQuestion.number)?.showResult || false"
        :disabled="appMode === 'endorse'"
        :is-correct="answerSheet.get(currentQuestion.number)?.isCorrect ?? false"
        :sub-results="answerSheet.get(currentQuestion.number)?.subAnswers"
        :app-mode="appMode"
        :bank-file="currentBankFile"
        :wrong-entry-id="wrongDisplayEntryIds[currentQuestionIndex] ?? 0"
        @update:model-value="$emit('answerUpdate', $event, currentQuestion)"
        @submit="$emit('submit', currentQuestion)"
        @compound-submit="$emit('compoundSubmit', currentQuestion, $event)"
        @compound-submit-sub="(subId: number, answer: string) => emit('subSubmit', currentQuestion!, subId, answer)"
      />
    </article>
    <MobileBottomNav
      :current-index="currentQuestionIndex"
      :total-questions="totalQuestions"
      :is-exam="appMode === 'exam'"
      @previous="$emit('previous')"
      @answer-sheet="$emit('answerSheet')"
      @next="$emit('next')"
      @submit-exam="$emit('submitExam')"
    />
  </template>
  <p v-else class="mobile-panel">暂无题目。<button class="mobile-action" type="button" @click="$emit('home')">返回首页</button></p>
</template>

<script setup lang="ts">
import type { AppMode, Question, SubAnswer, UserAnswer } from '../../types'
import type { AnswerSheetEntry } from '../../composables/useQuiz'
import QuestionDisplay from '../QuestionDisplay.vue'
import MobileBottomNav from './MobileBottomNav.vue'

defineProps<{
  appMode: AppMode
  modeLabel: string
  renderError: string
  currentQuestion?: Question
  currentQuestionIndex: number
  totalQuestions: number
  answerSheet: Map<number, AnswerSheetEntry>
  wrongDisplayEntryIds: number[]
  currentBankFile: string
}>()
const emit = defineEmits<{
  (event: 'answerUpdate', answer: UserAnswer, question: Question): void
  (event: 'submit', question: Question): void
  (event: 'compoundSubmit', question: Question, answers: Map<number, SubAnswer>): void
  (event: 'subSubmit', question: Question, subId: number, answer: string): void
  (event: 'previous'): void
  (event: 'answerSheet'): void
  (event: 'next'): void
  (event: 'submitExam'): void
  (event: 'home'): void
  (event: 'resetError'): void
}>()
</script>
