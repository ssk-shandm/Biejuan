<template>
  <div class="compound-question">
    <!-- 场景区 -->
    <div v-if="question.scenario" class="scenario-block">
      <h4 class="scenario-title">📋 场景</h4>
      <MarkdownContent class="scenario-content" :content="question.scenario" :format="question.scenarioFormat" />
    </div>

    <!-- 子题列表 -->
    <div class="sub-questions-list">
      <div
        v-for="sub in question.subQuestions"
        :key="sub.id"
        class="sub-question-item"
        :class="getSubResultClass(sub.id)"
      >
        <div class="sub-question-header">
          <span class="sub-question-number">{{ questionNumber }}.{{ sub.id }}</span>
          <span v-if="safeSubResults.get(sub.id)?.isCorrect === true" class="sub-badge correct">✓</span>
          <span v-else-if="safeSubResults.get(sub.id)?.isCorrect === false" class="sub-badge incorrect">✗</span>
        </div>
        <MarkdownContent class="sub-question-text" :content="sub.question" :format="sub.format" />

        <!-- ═══ 单选题子题 ═══ -->
        <template v-if="getSubType(sub) === '单选题'">
          <div class="sub-options">
            <label
              v-for="(text, key) in sub.options"
              :key="key"
              class="sub-option-label"
              :class="getSubOptionClass(sub, key)"
            >
              <input
                type="radio"
                :name="'sub-' + question.number + '-' + sub.id"
                :value="key"
                :checked="userAnswers.get(sub.id) === key"
                @change="handleInput(sub.id, key)"
                :disabled="isSubLocked(sub.id)"
              />
              <strong>{{ key }}:</strong><MarkdownContent class="sub-option-content" :content="text" :format="inheritedContentFormat(sub.format)" />
            </label>
            <button
              v-if="!isSubLocked(sub.id)"
              class="sub-submit-btn"
              @click="handleSubmitSub(sub.id)"
              :disabled="!userAnswers.get(sub.id)"
            >提交本题</button>
          </div>
          <div v-if="safeSubResults.get(sub.id)" class="sub-answer-display">
            <span class="sub-user-answer">你的答案：{{ userAnswers.get(sub.id) || '—' }}</span>
            <span class="sub-correct-answer">正确答案：{{ sub.answer }}</span>
          </div>
        </template>

        <!-- ═══ 多选题子题 ═══ -->
        <template v-else-if="getSubType(sub) === '多选题'">
          <div class="sub-options">
            <label
              v-for="(text, key) in sub.options"
              :key="key"
              class="sub-option-label"
              :class="getSubOptionClass(sub, key)"
            >
              <input
                type="checkbox"
                :value="key"
                :checked="(userAnswers.get(sub.id) || '').includes(key)"
                @change="updateCheckbox(sub.id, key)"
                :disabled="isSubLocked(sub.id)"
              />
              <strong>{{ key }}:</strong><MarkdownContent class="sub-option-content" :content="text" :format="inheritedContentFormat(sub.format)" />
            </label>
            <button
              v-if="!isSubLocked(sub.id)"
              class="sub-submit-btn"
              @click="handleSubmitSub(sub.id)"
              :disabled="!(userAnswers.get(sub.id) || '')"
            >提交本题</button>
          </div>
          <div v-if="safeSubResults.get(sub.id)" class="sub-answer-display">
            <span class="sub-user-answer">你的答案：{{ formatMulti(userAnswers.get(sub.id)) || '—' }}</span>
            <span class="sub-correct-answer">正确答案：{{ formatMulti(sub.answer) }}</span>
          </div>
        </template>

        <!-- ═══ 填空题子题 ═══ -->
        <template v-else-if="getSubType(sub) === '填空题'">
          <div class="sub-fill-area">
            <input
              type="text"
              class="sub-fill-input"
              :value="userAnswers.get(sub.id) || ''"
              @input="handleInput(sub.id, ($event.target as HTMLInputElement).value)"
              :placeholder="'请输入答案...'"
              :disabled="isSubLocked(sub.id)"
            />
            <button
              v-if="!isSubLocked(sub.id)"
              class="sub-submit-btn"
              @click="handleSubmitSub(sub.id)"
              :disabled="!(userAnswers.get(sub.id) || '').trim()"
            >提交本题</button>
          </div>
          <div v-if="safeSubResults.get(sub.id)" class="sub-answer-display">
            <span class="sub-user-answer">你的答案：{{ userAnswers.get(sub.id) || '—' }}</span>
            <div class="sub-correct-answer">正确答案：<MarkdownContent :content="sub.answer" :format="sub.answerFormat" /></div>
          </div>
        </template>

        <!-- ═══ 文本题子题（默认，原 SQL 行为） ═══ -->
        <template v-else>
          <div v-if="!disabled && !safeSubResults.get(sub.id)" class="sub-input-area">
            <textarea
              class="sub-textarea"
              :value="userAnswers.get(sub.id) || ''"
              @input="handleInput(sub.id, ($event.target as HTMLTextAreaElement).value)"
              :placeholder="'请输入 SQL 语句...'"
              rows="4"
            ></textarea>
            <button
              class="sub-submit-btn"
              @click="handleSubmitSub(sub.id)"
              :disabled="!(userAnswers.get(sub.id) || '').trim()"
            >提交本题</button>
          </div>
          <div v-if="safeSubResults.get(sub.id)" class="sub-result-area">
            <MarkdownContent class="markdown-answer-block" :content="sub.answer" :format="sub.answerFormat" />
          </div>
          <!-- 背题模式 -->
          <div v-if="disabled && !showResults && !safeSubResults.get(sub.id)" class="sub-result-area">
            <MarkdownContent class="markdown-answer-block" :content="sub.answer" :format="sub.answerFormat" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Question, SubAnswer, AppMode, SubQuestion } from '../types'
import MarkdownContent from './MarkdownContent.vue'
import { inheritedContentFormat } from '../utils/contentFormat'

const props = withDefaults(
  defineProps<{
    question: Question
    questionNumber: number
    totalQuestions: number
    disabled: boolean
    subResults?: Map<number, SubAnswer>
    showResults: boolean
    appMode: AppMode
  }>(),
  {
    disabled: false,
    showResults: false,
  },
)

const emit = defineEmits<{
  (e: 'submit', subAnswers: Map<number, SubAnswer>): void
  (e: 'submit-sub', subId: number, userAnswer: string): void
}>()

// 子题用户输入（内部状态）
const userAnswers = ref(new Map<number, string>())

// 当 showResults 或 disabled 变化时重置
watch(
  () => props.showResults,
  (newVal) => {
    if (!newVal) {
      userAnswers.value = new Map()
    }
  },
)


/** 安全的 subResults，确保始终是 Map（防止 session 恢复后变成普通对象） */
const safeSubResults = computed(() => {
  const sr = props.subResults
  if (!sr || typeof sr.get !== 'function') return new Map<number, SubAnswer>()
  return sr
})

/** 获取子题类型，默认为文本题 */
function getSubType(sub: SubQuestion): string {
  return sub.type || '文本题'
}


function getSubResultClass(subId: number): string {
  const result = safeSubResults.value.get(subId)
  if (!result) return ''
  return result.isCorrect ? 'sub-correct' : 'sub-incorrect'
}

function handleInput(subId: number, value: string) {
  userAnswers.value.set(subId, value)
  userAnswers.value = new Map(userAnswers.value)
}

/** 多选题复选框切换 */
function updateCheckbox(subId: number, key: string) {
  let current = (userAnswers.value.get(subId) || '').split('').filter((c) => c.trim())
  if (current.includes(key)) {
    current = current.filter((c) => c !== key)
  } else {
    current.push(key)
  }
  current.sort()
  userAnswers.value.set(subId, current.join(''))
  userAnswers.value = new Map(userAnswers.value)
}

/** 多选题答案格式化显示 */
function formatMulti(answer?: string): string {
  if (!answer) return ''
  return answer.split('').join(', ')
}

/** 子题是否已锁定（已提交或背题模式） */
function isSubLocked(subId: number): boolean {
  return !!safeSubResults.value.get(subId) || props.disabled
}

/** 获取选项的样式类（提交后高亮正确/错误选项） */
function getSubOptionClass(sub: SubQuestion, key: string): string {
  const result = safeSubResults.value.get(sub.id)
  if (!result) return ''
  const correctKeys = sub.answer.split('')
  const userKeys = (result.userAnswer || '').split('')
  if (correctKeys.includes(key)) return 'sub-option-correct'
  if (userKeys.includes(key)) return 'sub-option-wrong'
  return ''
}

function handleSubmitSub(subId: number) {
  const userAnswer = (userAnswers.value.get(subId) || '').trim()
  if (!userAnswer) return
  emit('submit-sub', subId, userAnswer)
}
</script>

<style scoped>
.compound-question {
  margin-top: 10px;
}

/* 场景区块 */
.scenario-block {
  margin-bottom: 20px;
  padding: 16px;
  background-color: var(--color-bg-scenario);
  border: 1px solid var(--color-border-scenario);
  border-radius: 8px;
}
.scenario-title {
  margin: 0 0 10px 0;
  font-size: 1rem;
  color: var(--color-text-scenario-title);
}
.scenario-content {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--color-text-scenario-body);
}

/* 子题列表 */
.sub-questions-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sub-question-item {
  padding: 14px;
  border: 1px solid var(--color-border-surface);
  border-radius: 8px;
  background-color: var(--color-bg-surface);
  transition: border-color 0.2s;
}
.sub-question-item.sub-correct {
  border-color: var(--color-border-correct);
  background-color: var(--color-bg-sub-correct);
}
.sub-question-item.sub-incorrect {
  border-color: var(--color-border-incorrect);
  background-color: var(--color-bg-sub-incorrect);
}

.sub-question-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}
.sub-question-number {
  font-weight: 700;
  color: var(--color-text-sub-number);
  white-space: nowrap;
  font-size: 0.95rem;
}
.sub-question-text {
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.5;
  margin-bottom: 10px;
  overflow-x: auto;
}
.sub-question-text :deep(table) {
  border-collapse: collapse;
  width: 100%;
  min-width: 480px;
  margin: 8px 0;
  font-size: 0.85rem;
}
.sub-question-text :deep(th),
.sub-question-text :deep(td) {
  border: 1px solid var(--color-border-surface);
  padding: 6px 10px;
  text-align: left;
}
.sub-question-text :deep(th) {
  background-color: var(--color-bg-scenario);
  font-weight: 600;
}
.sub-question-text :deep(code) {
  background-color: var(--color-bg-code-inline);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.9em;
}
.sub-badge {
  font-weight: 700;
  font-size: 1rem;
  white-space: nowrap;
}
.sub-badge.correct {
  color: var(--color-badge-correct);
}
.sub-badge.incorrect {
  color: var(--color-badge-incorrect);
}

/* 选项列表（单选/多选） */
.sub-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sub-option-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-input);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--color-text-primary);
  transition: background-color 0.15s;
}
.sub-option-label:hover {
  background-color: var(--color-bg-input-hover, rgba(0, 0, 0, 0.03));
}
.sub-option-content {
  flex: 1;
  min-width: 0;
}
.sub-option-label input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
.sub-option-label.sub-option-correct {
  border-color: var(--color-border-correct);
  background-color: var(--color-bg-sub-correct);
}
.sub-option-label.sub-option-wrong {
  border-color: var(--color-border-incorrect);
  background-color: var(--color-bg-sub-incorrect);
}

/* 填空题输入 */
.sub-fill-area {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.sub-fill-input {
  flex: 1;
  padding: 10px 12px;
  font-size: 1rem;
  border: 1px solid var(--color-border-input);
  border-radius: 6px;
  background-color: var(--color-bg-input);
  color: var(--color-text-input);
  box-sizing: border-box;
}
.sub-fill-input:focus {
  outline: none;
  border-color: var(--color-border-input-focus);
  box-shadow: 0 0 0 2px var(--color-shadow-input-focus);
}

/* 答案显示区（单选/多选/填空提交后） */
.sub-answer-display {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background-color: var(--color-bg-sub-answer);
  border-radius: 6px;
  font-size: 0.88rem;
}
.sub-user-answer {
  color: var(--color-text-primary);
}
.sub-correct-answer {
  color: var(--color-badge-correct);
  font-weight: 600;
}

/* 文本题输入区 */
.sub-textarea {
  width: 100%;
  padding: 10px 12px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 1rem;
  line-height: 1.5;
  border: 1px solid var(--color-border-input);
  border-radius: 6px;
  resize: vertical;
  box-sizing: border-box;
  background-color: var(--color-bg-input);
  color: var(--color-text-input);
}
.sub-textarea:focus {
  outline: none;
  border-color: var(--color-border-input-focus);
  box-shadow: 0 0 0 2px var(--color-shadow-input-focus);
}

/* 结果区 */
.sub-result-area {
  margin-top: 6px;
}

/* Markdown 答案块 */
.markdown-answer-block {
  margin: 6px 0;
  line-height: 1.6;
}
.markdown-answer-block :deep(pre) {
  margin: 8px 0;
  padding: 0;
  background: transparent;
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid var(--color-border-code-block);
}
.markdown-answer-block :deep(code.hljs) {
  display: block;
  padding: 10px 14px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  border-radius: 6px;
}
.markdown-answer-block :deep(code:not(.hljs)) {
  background-color: var(--color-bg-code-inline);
  padding: 2px 5px;
  border-radius: 3px;
  font-family: 'Fira Code', Consolas, Monaco, monospace;
  font-size: 0.9em;
}

/* 逐题提交按钮 */
.sub-submit-btn {
  width: 100%;
  padding: 8px;
  margin-top: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-btn-success);
  background-color: var(--color-bg-btn-success);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.sub-submit-btn:hover {
  background-color: var(--color-bg-btn-success-hover);
}
.sub-submit-btn:disabled {
  background-color: var(--color-bg-btn-success-disabled);
  cursor: not-allowed;
}
</style>
