<template>
  <div id="result-container">
    <p id="result-text" :class="resultTextClass">{{ resultText }}</p>

    <div v-if="!isCorrect && acceptedAlternatives.length && !isShortAnswer" class="accepted-alternatives">
      <p><strong>可接受的答案：</strong>{{ acceptedAlternatives.join('、') }}</p>
    </div>

    <div v-if="showAnswerBlock" class="answer-block">
      <p v-if="!isShortAnswer"><strong>参考答案：</strong></p>
      <MarkdownContent
        :class="isRichAnswer ? 'markdown-answer-content' : 'plain-answer'"
        :content="correctAnswer"
        :format="answerFormat || 'text'"
      />
    </div>

    <div id="explanation-text" v-if="explanation">
      <MarkdownContent :content="explanation" :format="explanationFormat || 'text'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ContentFormat, UserAnswer } from '../types'
import MarkdownContent from './MarkdownContent.vue'
import { normalizeContentFormat } from '../utils/contentFormat'

const props = withDefaults(defineProps<{
  isCorrect: boolean
  correctAnswer: string
  explanation: string
  userAnswer: UserAnswer
  answerFormat?: ContentFormat
  explanationFormat?: ContentFormat
  codeLanguage?: string
  answerDetail?: { accepts: string[] }
  questionType?: string
}>(), {
  isCorrect: false,
  answerFormat: undefined,
  explanationFormat: undefined,
  codeLanguage: undefined,
  answerDetail: undefined,
  questionType: undefined,
})

const isShortAnswer = computed(() => props.questionType === '简答题' || props.questionType === '简答')
const isRichAnswer = computed(() => normalizeContentFormat(props.answerFormat) !== 'text')
const showAnswerBlock = computed(() => isRichAnswer.value || isShortAnswer.value)

const acceptedAlternatives = computed(() => {
  if (!props.answerDetail?.accepts?.length) return []
  const correctNormalized = props.correctAnswer.trim().toLowerCase()
  return props.answerDetail.accepts.filter((answer) => answer.trim().toLowerCase() !== correctNormalized)
})

const resultTextClass = computed(() => {
  if (isShortAnswer.value) return 'neutral'
  return props.isCorrect ? 'correct' : 'incorrect'
})

const resultText = computed(() => {
  if (isShortAnswer.value) return '参考回答：'
  if (props.isCorrect) return '回答正确！'
  if (isRichAnswer.value) return '回答错误。正确答案见下方。'
  return `回答错误。正确答案: ${props.correctAnswer}。`
})
</script>
<style scoped>
#result-container {
  margin-top: 20px;
}
#result-container p {
  margin: 10px 0;
  padding: 10px;
  border-radius: 8px;
}
#explanation-text {
  background-color: var(--color-bg-explanation);
  border-left: 4px solid var(--color-border-surface);
  color: var(--color-text-secondary);
}
.correct {
  background-color: var(--color-bg-sub-correct);
  border-left: 4px solid var(--color-border-correct-left);
  color: var(--color-text-correct);
}
.incorrect {
  background-color: var(--color-bg-sub-incorrect);
  border-left: 4px solid var(--color-border-incorrect-left);
  color: var(--color-text-incorrect);
}
.neutral {
  background-color: var(--color-bg-explanation);
  border-left: 4px solid var(--color-border-surface);
  color: var(--color-text-secondary);
}

.accepted-alternatives {
  margin: 8px 0;
  padding: 10px;
  background-color: var(--color-bg-explanation);
  border-left: 4px solid var(--color-border-surface);
  color: var(--color-text-secondary);
  border-radius: 8px;
  font-size: 0.9rem;
}
.accepted-alternatives strong {
  color: var(--color-text-primary);
}

.answer-block {
  margin: 8px 0;
  line-height: 1.6;
}
.answer-block .plain-answer {
  padding: 10px;
  background-color: var(--color-bg-explanation);
  border-left: 4px solid var(--color-border-surface);
  color: var(--color-text-primary);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.markdown-answer-content :deep(pre) {
  margin: 10px 0;
  padding: 0;
  background: transparent;
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid var(--color-border-code-block);
}
.markdown-answer-content :deep(code.hljs) {
  display: block;
  padding: 12px 16px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.9rem;
  line-height: 1.5;
  border-radius: 6px;
}
.markdown-answer-content :deep(code:not(.hljs)) {
  background-color: var(--color-bg-code-inline);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.9em;
}

#next-btn {
  width: 100%;
  padding: 12px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-btn-primary);
  background-color: var(--color-bg-btn-primary);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 20px;
}
#next-btn:hover {
  background-color: var(--color-bg-btn-primary-hover);
}
</style>
