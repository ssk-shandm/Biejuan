<template>
  <label class="quiz-presentation-switch">
    <input
      type="checkbox"
      role="switch"
      aria-label="桌面做题呈现：滚动 / 传统"
      :checked="modelValue === 'single'"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked ? 'single' : 'continuous')"
    />
  </label>
</template>

<script setup lang="ts">
import type { QuizPresentation } from '../composables/useQuizPresentation'

defineProps<{ modelValue: QuizPresentation }>()
const emit = defineEmits<{ 'update:modelValue': [value: QuizPresentation] }>()
</script>

<style scoped>
.quiz-presentation-switch { display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.quiz-presentation-switch input { appearance: none; width: 44px; height: 24px; margin: 0; padding: 3px; border-radius: 20px; background: var(--color-border-divider); cursor: pointer; }
.quiz-presentation-switch input::before { content: ''; display: block; width: 18px; height: 18px; background: var(--color-bg-container); border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,.2); transition: transform .18s ease; }
.quiz-presentation-switch input:checked { background: var(--color-accent); }
.quiz-presentation-switch input:checked::before { transform: translateX(20px); }
.quiz-presentation-switch input:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) { .quiz-presentation-switch input::before { transition: none; } }
</style>
