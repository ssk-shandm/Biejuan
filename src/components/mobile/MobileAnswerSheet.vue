<template>
  <div v-if="open" class="mobile-sheet" @click.self="$emit('close')">
    <div class="mobile-sheet-panel" role="dialog" aria-modal="true" aria-label="答题卡">
      <div class="mobile-quiz-header">
        <h2>答题卡</h2>
        <button class="mobile-action" type="button" @click="$emit('close')">关闭</button>
      </div>
      <div class="mobile-sheet-grid">
        <button
          v-for="(question, index) in shuffledQuestions"
          :key="question.number"
          type="button"
          :aria-current="index === currentIndex"
          :aria-label="`第 ${index + 1} 题${answerSheet.has(question.number) ? '，已答' : ''}`"
          @click="$emit('jump', index)"
        >
          {{ index + 1 }}{{ answerSheet.has(question.number) ? '·' : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Question } from '../../types'
import type { AnswerSheetEntry } from '../../composables/useQuiz'
defineProps<{
  open: boolean
  shuffledQuestions: Question[]
  answerSheet: Map<number, AnswerSheetEntry>
  currentIndex: number
}>()
defineEmits<{ (event: 'close'): void; (event: 'jump', index: number): void }>()
</script>
