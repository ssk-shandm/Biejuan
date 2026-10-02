<template>
  <div class="quiz-layout">
    <div class="quiz-sidebar" :class="{ 'is-collapsed': !isAnswerCardExpanded }">
      <AnswerCard
        :questions="filteredQuestions"
        :answer-sheet="answerSheet"
        :current-index="answerCardCurrentIndex"
        :display-numbers="answerCardDisplayNumbers"
        app-mode="review"
        :default-expanded="true"
        :default-pinned="true"
        @jumpTo="handleJumpTo"
        @update:expanded="isAnswerCardExpanded = $event"
      />

      <div class="review-sidebar-details">
        <div class="filter-container">
          <label>
            <input type="checkbox" v-model="showOnlyWrong" />
            只看错题
          </label>
        </div>

        <div id="final-score-container">
          <h3>考试结束！</h3>
          <p id="final-score-text">你答对了 {{ score }} / {{ totalQuestions }} 题。</p>
          <button id="restart-btn" @click="emit('restart', 'start')">返回首页</button>
        </div>
      </div>
    </div>

    <div class="quiz-container quiz-main-area">
      <h2 v-if="filteredQuestions.length === 0" class="no-questions-text">
        {{ showOnlyWrong ? '你没有错题，太棒了！' : '没有题目。' }}
      </h2>

      <div
        v-for="question in filteredQuestions"
        :key="question.number"
        :id="'q-' + question.number"
        class="review-question-block"
      >
        <QuestionDisplay
          :question="question"
          :question-number="shuffledQuestions.indexOf(question) + 1"
          :total-questions="totalQuestions"
          :model-value="answerSheet.get(question.number)?.userAnswer ?? null"
          :show-result="false"
          :disabled="true"
          :app-mode="'review'"
          :sub-results="answerSheet.get(question.number)?.subAnswers"
        />
        <ResultDisplay
          v-if="!question.subQuestions?.length"
          :is-correct="answerSheet.get(question.number)?.isCorrect || false"
          :correct-answer="question.answer"
          :explanation="question.explanation"
          :user-answer="answerSheet.get(question.number)?.userAnswer ?? ''"
          :answer-format="question.answerFormat"
          :explanation-format="question.explanationFormat"
          :code-language="question.codeLanguage"
          :answer-detail="question.answerDetail"
          :question-type="question.type"
        />
        <!-- 复合题：显示子题结果汇总 -->
        <div v-else class="compound-review-summary">
          <p class="compound-score-text">
            子题正确率：
            <strong>{{ getCompoundCorrectCount(question) }}/{{ question.subQuestions?.length }}</strong>
          </p>
          <div
            v-for="sub in question.subQuestions"
            :key="sub.id"
            class="review-sub-item"
            :class="getSubReviewClass(question.number, sub.id)"
          >
            <div class="review-sub-header">
              <span class="review-sub-num">{{ question.number }}.{{ sub.id }}</span>
              <MarkdownContent class="review-sub-q" :content="sub.question" :format="sub.format" />
              <span
                v-if="getSubReviewResult(question.number, sub.id) === true"
                class="review-sub-badge correct"
              >✓</span>
              <span
                v-else-if="getSubReviewResult(question.number, sub.id) === false"
                class="review-sub-badge incorrect"
              >✗</span>
            </div>
            <!-- 答案对比（单选/多选/填空子题） -->
            <div
              v-if="getSubUserAnswer(question.number, sub.id) !== null"
              class="review-sub-answers"
            >
              <span class="review-sub-user">你的答案：{{ getSubUserAnswer(question.number, sub.id) || '（未作答）' }}</span>
              <div class="review-sub-correct">正确答案：<MarkdownContent :content="formatSubAnswer(sub)" :format="sub.answerFormat" /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { Question, UserAnswer, SubAnswer } from '../types'
import AnswerCard from './AnswerCard.vue'
import QuestionDisplay from './QuestionDisplay.vue'
import ResultDisplay from './ResultDisplay.vue'
import MarkdownContent from './MarkdownContent.vue'

// 定义 props
const props = defineProps<{
  questions: Question[]
  answerSheet: Map<
    number,
    { userAnswer: UserAnswer; isCorrect: boolean | null; subAnswers?: Map<number, SubAnswer> }
  >
  score: number
}>()

// 定义 emits
const emit = defineEmits<{
  (e: 'restart', mode: 'start'): void
}>()

const showOnlyWrong = ref(false)
const isAnswerCardExpanded = ref(true)
const currentQuestionIndex = ref(0) // 用于高亮答题卡
const shuffledQuestions = computed(() => props.questions)
const totalQuestions = computed(() => props.questions.length)

// 核心：筛选题目 (要求 4)
const filteredQuestions = computed(() => {
  if (!showOnlyWrong.value) {
    return props.questions
  }
  return props.questions.filter((q) => {
    const entry = props.answerSheet.get(q.number)
    return entry?.isCorrect === false
  })
})

// 筛选后答题卡只展示当前可见题目，但仍保留其在整张试卷中的题号。
const answerCardDisplayNumbers = computed(() =>
  filteredQuestions.value.map((question) => props.questions.indexOf(question) + 1),
)

const answerCardCurrentIndex = computed(() => {
  const currentQuestion = props.questions[currentQuestionIndex.value]
  if (!currentQuestion) return -1
  return filteredQuestions.value.findIndex((question) => question.number === currentQuestion.number)
})

async function handleJumpTo(index: number) {
  const question = filteredQuestions.value[index]
  if (!question) return

  const sourceIndex = props.questions.findIndex((item) => item.number === question.number)
  if (sourceIndex >= 0) currentQuestionIndex.value = sourceIndex

  await nextTick()
  const element = document.getElementById('q-' + question.number)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// 复合题辅助函数
function getCompoundCorrectCount(question: Question): number {
  const entry = props.answerSheet.get(question.number)
  if (!entry?.subAnswers) return 0
  let count = 0
  for (const sub of question.subQuestions || []) {
    const sa = entry.subAnswers.get(sub.id)
    if (sa?.isCorrect === true) count++
  }
  return count
}

function getSubReviewResult(qNum: number, subId: number): boolean | null {
  return props.answerSheet.get(qNum)?.subAnswers?.get(subId)?.isCorrect ?? null
}

/** 获取子题的用户答案文本 */
function getSubUserAnswer(qNum: number, subId: number): string | null {
  const sa = props.answerSheet.get(qNum)?.subAnswers?.get(subId)
  return sa?.userAnswer ?? null
}

/** 格式化子题正确答案用于展示（多选题字母间加逗号） */
function formatSubAnswer(sub: { type?: string; answer: string }): string {
  if (sub.type === '多选题' && sub.answer) {
    return sub.answer.split('').join(', ')
  }
  return sub.answer
}

function getSubReviewClass(qNum: number, subId: number): string {
  const result = getSubReviewResult(qNum, subId)
  if (result === true) return 'sub-review-correct'
  if (result === false) return 'sub-review-incorrect'
  return ''
}
</script>

<style scoped>
.quiz-layout {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  width: 90%;
  max-width: 1200px;
  margin: 20px auto;
}

.quiz-sidebar {
  position: sticky;
  top: 20px;
  align-self: flex-start;
  flex: 0 0 auto;
  width: 280px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
  color: var(--color-text-primary);
  transition: width 0.3s ease;
}

.quiz-sidebar.is-collapsed {
  width: 36px;
}

.review-sidebar-details {
  width: 280px;
  max-height: 500px;
  overflow: hidden;
  opacity: 1;
  visibility: visible;
  transition: max-height 0.3s ease, opacity 0.15s ease, visibility 0s linear 0s;
}

.quiz-sidebar.is-collapsed .review-sidebar-details {
  max-height: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.1s ease, visibility 0s linear 0.3s;
}

.quiz-main-area {
  background-color: var(--color-bg-container);
  border-radius: 12px;
  box-shadow: var(--color-shadow-container);
  border: 1px solid var(--color-border-container);
  padding: 24px;
  box-sizing: border-box;
  flex: 1;
  max-width: 800px;
  margin: 0 auto;
}
.no-questions-text {
  text-align: center;
  color: var(--color-text-secondary);
  padding: 40px;
}
.filter-container {
  margin-top: 20px;
  padding: 15px;
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-surface);
  border-radius: 8px;
  font-weight: 500;
  color: var(--color-text-primary);
}
.filter-container label {
  display: flex;
  align-items: center;
  cursor: pointer;
}
.filter-container input {
  margin-right: 10px;
  width: 16px;
  height: 16px;
}
#final-score-container {
  text-align: center;
  margin-top: 20px;
  padding: 15px;
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-surface);
  border-radius: 8px;
  color: var(--color-text-primary);
}
#final-score-text {
  font-size: 1.2rem;
  font-weight: 600;
  margin: 10px 0;
  color: var(--color-text-primary);
}
#restart-btn {
  width: 100%;
  padding: 12px;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-btn-primary);
  background-color: var(--color-bg-btn-primary);
  border: 1px solid var(--color-border-btn-primary);
  border-radius: 8px;
  cursor: pointer;
  margin-top: 10px;
}
#restart-btn:hover {
  background-color: var(--color-bg-btn-primary-hover);
}
.review-question-block {
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border-divider);
  scroll-margin-top: 20px;
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}
.review-question-block:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

@media (max-width: 768px) {
  .quiz-layout {
    display: block;
  }
  .quiz-sidebar {
    position: static;
    top: auto;
    max-height: none;
    overflow-y: visible;
    width: 100%;
    max-width: 100%;
  }
  .quiz-sidebar.is-collapsed {
    width: 36px;
  }
}

.compound-review-summary {
  margin-top: 15px;
  padding: 12px;
  background-color: var(--color-bg-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border-surface);
}
.compound-score-text {
  margin: 0 0 10px 0;
  font-size: 1rem;
  color: var(--color-text-primary);
}
.review-sub-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  margin: 4px 0;
  border-radius: 4px;
  font-size: 0.9rem;
}
.review-sub-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.review-sub-item.sub-review-correct {
  background-color: var(--color-bg-sub-correct);
}
.review-sub-item.sub-review-incorrect {
  background-color: var(--color-bg-sub-incorrect);
}
.review-sub-num {
  font-weight: 700;
  color: var(--color-text-sub-number);
  white-space: nowrap;
}
.review-sub-q {
  flex: 1;
  color: var(--color-text-secondary);
}
.review-sub-badge {
  font-weight: 700;
  font-size: 1rem;
}
.review-sub-badge.correct {
  color: var(--color-badge-correct);
}
.review-sub-badge.incorrect {
  color: var(--color-badge-incorrect);
}
.review-sub-answers {
  display: flex;
  gap: 16px;
  padding-left: 28px;
  font-size: 0.85rem;
}
.review-sub-user {
  color: var(--color-text-primary);
}
.review-sub-correct {
  color: var(--color-badge-correct);
  font-weight: 600;
}
</style>
