<template>
  <div id="result-container">
    <p id="result-text" :class="resultTextClass">{{ resultText }}</p>

    <div v-if="!isCorrect && acceptedAlternatives.length && !isShortAnswer" class="result-section accepted-alternatives">
      <div class="result-section-title">可接受的答案</div>
      <MarkdownContent :content="acceptedAlternatives.join('、')" :format="answerFormat" />
    </div>

    <section class="result-section answer-block" :aria-label="isShortAnswer ? '参考回答' : '参考答案'">
      <div class="result-section-title">{{ isShortAnswer ? '参考回答' : '参考答案' }}</div>
      <p v-if="!hasAnswer" class="answer-missing">此题原文未提供答案，可在题库中补充后再练习。</p>
      <MarkdownContent
        v-else
        class="markdown-answer-content"
        :content="correctAnswer"
        :format="answerFormat"
      />
    </section>

    <section id="explanation-text" v-if="explanation" class="result-section" aria-label="解析">
      <div class="result-section-title">解析</div>
      <MarkdownContent :content="explanation" :format="explanationFormat" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ContentFormat, UserAnswer } from '../types'
import MarkdownContent from './MarkdownContent.vue'

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

const hasAnswer = computed(() => Boolean(props.correctAnswer?.trim()) || Boolean(props.answerDetail?.accepts?.length))

const acceptedAlternatives = computed(() => {
  if (!props.answerDetail?.accepts?.length) return []
  const correctNormalized = props.correctAnswer.trim().toLowerCase()
  return props.answerDetail.accepts.filter((answer) => answer.trim().toLowerCase() !== correctNormalized)
})

const resultTextClass = computed(() => {
  if (isShortAnswer.value) return 'neutral'
  if (!hasAnswer.value) return 'neutral'
  return props.isCorrect ? 'correct' : 'incorrect'
})

const resultText = computed(() => {
  if (isShortAnswer.value) return '本题为开放式作答，参考回答见下方。'
  if (!hasAnswer.value) return '本题原文未提供答案，暂不判分。'
  if (props.isCorrect) return '回答正确！'
  return '回答错误。正确答案见下方。'
})
</script>
<style scoped>
#result-container {
  margin-top: 20px;
  display: grid;
  gap: 12px;
}
#result-container > #result-text {
  margin: 10px 0;
  padding: 10px;
  border-radius: 8px;
}
.result-section {
  padding: 14px 16px;
  border: 1px solid var(--color-border-divider);
  border-radius: 10px;
  background: var(--color-bg-surface, var(--color-bg-container));
  color: var(--color-text-primary);
}
.result-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--color-text-heading);
  font-size: .92rem;
  font-weight: 700;
  letter-spacing: .02em;
}
.result-section-title::before {
  content: '';
  width: 4px;
  height: 1.1em;
  border-radius: 999px;
  background: var(--color-accent);
}
#explanation-text {
  background: var(--color-bg-explanation);
  border-left: 4px solid var(--color-border-explanation);
  color: var(--color-text-explanation);
}
#explanation-text .result-section-title {
  color: var(--color-text-explanation);
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
  background: var(--color-bg-explanation);
  border-left: 4px solid var(--color-border-surface);
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}
.accepted-alternatives strong {
  color: var(--color-text-primary);
}

.answer-block {
  line-height: 1.7;
  border-left: 4px solid var(--color-border-correct-left);
}
.answer-block .plain-answer {
  padding: 10px 12px;
  background: var(--color-bg-explanation);
  color: var(--color-text-primary);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.answer-missing {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.88rem;
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
#explanation-text > .markdown-content {
  line-height: 1.75;
}
#explanation-text :deep(p),
#explanation-text :deep(ul),
#explanation-text :deep(ol) {
  margin-top: 8px;
  margin-bottom: 8px;
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
