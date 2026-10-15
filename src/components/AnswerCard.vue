<template>
  <div class="answer-card-drawer" :class="{ 'is-collapsed': !isExpanded && !props.alwaysVisible, 'always-visible': props.alwaysVisible }">
    <div class="drawer-inner" @mouseleave="handleMouseLeave">
      <!-- 触发条 -->
      <div
        class="drawer-trigger"
        @mouseenter="handleMouseEnter"
        @click="toggleExpand"
      >
        <div class="trigger-bar">
          <span class="trigger-icon">☰</span>
          <span class="trigger-text">答题卡</span>
        </div>
      </div>

      <!-- 内容区 -->
      <div class="drawer-content">
        <div class="drawer-header">
          <h3>答题卡</h3>
          <button
            class="pin-btn"
            :disabled="props.alwaysVisible"
            @click.stop="togglePin"
            :title="props.alwaysVisible ? '传统模式下已固定' : (isPinned ? '取消固定' : '固定展开')"
          >
            {{ props.alwaysVisible || isPinned ? '📌' : '📍' }}
          </button>
        </div>
        <div class="card-grid">
          <button
            v-for="item in buttonItems"
            :key="item.key"
            :class="item.classes"
            :title="item.title"
            @click="emit('jumpTo', item.index)"
          >
            {{ item.label }}
          </button>
        </div>
        <button
          v-if="appMode === 'wrong' && questions.length > 0"
          @click="emit('clearAllWrong')"
          class="clear-all-btn"
        >
          一键移除所有错题
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Question, UserAnswer, SubAnswer, AppMode } from '../types'
import { useQuizStore } from '../stores/quizStore'

const quizStore = useQuizStore()

const props = withDefaults(defineProps<{
  questions: Question[]
  answerSheet: Map<
    number,
    {
      userAnswer: UserAnswer
      isCorrect: boolean | null
      subAnswers?: Map<number, SubAnswer>
      subDrafts?: Record<number, string>
    }
  >
  currentIndex: number
  appMode?: AppMode
  bankFile?: string
  wrongEntryIds?: number[]
  displayNumbers?: number[]
  defaultExpanded?: boolean
  defaultPinned?: boolean
  /** Traditional desktop layout keeps the answer card visible and pinned. */
  alwaysVisible?: boolean
}>(), {
  defaultExpanded: true,
  defaultPinned: false,
  alwaysVisible: false,
})

const emit = defineEmits<{
  (e: 'jumpTo', index: number): void
  (e: 'clearAllWrong'): void
  (e: 'update:expanded', expanded: boolean): void
}>()

// ---- 抽屉状态 ----
const isExpanded = ref(props.defaultExpanded)
const isPinned = ref(props.defaultPinned)

function setExpanded(expanded: boolean) {
  if (props.alwaysVisible) expanded = true
  if (isExpanded.value === expanded) return
  isExpanded.value = expanded
  emit('update:expanded', expanded)
}

function expand() {
  setExpanded(true)
}

function collapse() {
  setExpanded(false)
}

function toggleExpand() {
  if (props.alwaysVisible) return
  setExpanded(!isExpanded.value)
}

function togglePin() {
  if (props.alwaysVisible) return
  isPinned.value = !isPinned.value
  if (isPinned.value) {
    expand()
  }
}

function handleMouseEnter() {
  if (props.alwaysVisible) return
  if (!isExpanded.value) {
    expand()
  }
}

function handleMouseLeave() {
  if (props.alwaysVisible) return
  if (!isPinned.value) {
    collapse()
  }
}

// ---- 答题卡按钮样式（预计算，避免每次渲染 200+ 次 store 查询） ----
function computeButtonClass(question: Question, index: number): string[] {
  const classes = ['card-button']
  if (index === props.currentIndex) {
    classes.push('current')
  }

  const entry = props.answerSheet.get(question.number)

  // 复合题：检查子题
  if (question.subQuestions && question.subQuestions.length > 0) {
    if (Object.values(entry?.subDrafts ?? {}).some(answer => answer.trim())) {
      classes.push('answered')
    }
    if (entry?.subAnswers && entry.subAnswers.size > 0) {
      classes.push('answered')
      let correctCount = 0
      let totalAnswered = 0
      for (const sub of question.subQuestions) {
        const sa = entry.subAnswers.get(sub.id)
        if (sa) {
          totalAnswered++
          if (sa.isCorrect === true) correctCount++
        }
      }
      if (totalAnswered > 0) {
        // 回顾页必须把未作答的子题也计入总数，避免“只答一部分且都答对”被标成全对。
        const expectedCount = props.appMode === 'review'
          ? question.subQuestions.length
          : totalAnswered
        if (correctCount === expectedCount) {
          const isGR = props.bankFile ? quizStore.isGuessedRight(question.number, props.bankFile) : false
          classes.push(props.appMode === 'wrong' ? 'correct' : (
            isGR ? 'guessed-right' : 'correct'
          ))
        } else if (correctCount === 0) {
          classes.push('incorrect')
        } else {
          classes.push('partial')
        }
      }
    } else if (entry?.isCorrect === true) {
      classes.push('correct')
    } else if (entry?.isCorrect === false) {
      // 提交考试后，完全未作答的复合题没有 subAnswers，但仍应显示为错误。
      classes.push('incorrect')
    } else if (props.appMode === 'review' && entry?.isCorrect === null) {
      classes.push('ungraded')
    }
    return classes
  }

  if (entry?.userAnswer) {
    classes.push('answered')
  }

  if (entry?.isCorrect === true) {
    const isGR = props.bankFile ? quizStore.isGuessedRight(question.number, props.bankFile) : false
    classes.push(props.appMode === 'wrong' ? 'correct' : (
      isGR ? 'guessed-right' : 'correct'
    ))
  } else if (entry?.isCorrect === false) {
    classes.push('incorrect')
  } else if (props.appMode === 'review' && entry?.isCorrect === null) {
    // 简答题等主观题不自动判分，在回顾页使用独立颜色，避免看起来像漏题。
    classes.push('ungraded')
  }

  return classes
}

interface ButtonItem {
  key: string | number
  index: number
  label: number
  classes: string[]
  title: string
}

function getButtonTitle(classes: string[]): string {
  if (classes.includes('correct')) return '正确'
  if (classes.includes('guessed-right')) return '蒙对'
  if (classes.includes('incorrect')) return '错误或未作答'
  if (classes.includes('partial')) return '部分正确'
  if (classes.includes('ungraded')) return '主观题（不自动判分）'
  if (classes.includes('answered')) return '已作答'
  return '未作答'
}

const buttonItems = computed<ButtonItem[]>(() => {
  return props.questions.map((question, index) => {
    const classes = computeButtonClass(question, index)
    return {
      key: props.appMode === 'wrong' && props.wrongEntryIds
        ? (props.wrongEntryIds[index] ?? index)
        : (question.number ?? index),
      index,
      label: props.displayNumbers?.[index] ?? index + 1,
      classes,
      title: getButtonTitle(classes),
    }
  })
})
</script>

<style scoped>
/* ---- 抽屉布局 ---- */
.answer-card-drawer {
  width: 280px;
  max-width: 100%;
  margin: 0 auto;
  overflow: hidden;
  transition: width 0.3s ease;
  border-radius: 8px;
  min-height: 200px;
  max-height: calc(100vh - 40px);
  display: flex;
  box-sizing: border-box;
}

.answer-card-drawer.is-collapsed {
  width: 36px;
}

.drawer-inner {
  display: flex;
  flex: 0 0 280px;
  width: 280px;
  min-width: 280px;
  height: 100%;
}

.drawer-trigger {
  width: 36px;
  flex-shrink: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg-surface-alt);
  border-right: 1px solid var(--color-border-divider);
  user-select: none;
  transition: background-color 0.2s;
}

.drawer-trigger:hover {
  background-color: var(--color-bg-surface-hover);
}

.trigger-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.trigger-icon {
  font-size: 1.1rem;
}

.trigger-text {
  writing-mode: vertical-rl;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: 2px;
}

.drawer-content {
  flex: 0 0 244px;
  width: 244px;
  min-width: 244px;
  padding: 15px;
  box-sizing: border-box;
  background-color: var(--color-bg-surface-alt);
  transition: background-color 0.3s, color 0.3s;
  overflow-y: auto;
  overflow-x: hidden;
  max-height: calc(100vh - 80px);
}

/* ---- 头部 ---- */
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 15px;
}

.drawer-header h3 {
  margin: 0;
  color: var(--color-text-heading);
}

.pin-btn {
  padding: 4px 8px;
  font-size: 0.85rem;
  border: 1px solid var(--color-border-input);
  border-radius: 4px;
  background-color: var(--color-bg-container);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background-color 0.2s;
}

.pin-btn:hover {
  background-color: var(--color-bg-surface-hover);
}

/* ---- 答题卡网格 ---- */
.card-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.card-button {
  width: 35px;
  height: 35px;
  border: 1px solid var(--color-border-input);
  background-color: var(--color-bg-container);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-primary);
  transition: all 0.2s;
  contain: layout style;
}

.card-button:hover {
  background-color: var(--color-bg-surface);
}

.card-button.current {
  border-color: var(--color-accent);
  background-color: var(--color-accent);
  color: #fff;
}

.card-button.answered {
  background-color: var(--color-bg-btn-secondary);
  color: var(--color-text-secondary);
}

.card-button.correct {
  background-color: var(--color-bg-correct);
  border-color: var(--color-border-correct);
  color: var(--color-text-correct);
}

.card-button.incorrect {
  background-color: var(--color-bg-incorrect);
  border-color: var(--color-border-incorrect);
  color: var(--color-text-incorrect);
}

.card-button.partial {
  background-color: var(--color-bg-warning);
  border-color: var(--color-border-warning);
  color: var(--color-text-warning);
}

.card-button.ungraded {
  background-color: var(--color-bg-btn-info);
  border-color: var(--color-border-btn-info);
  color: var(--color-text-btn-info);
}

.card-button.guessed-right {
  background-color: #fff3cd;
  border-color: #ff9800;
  color: #e65100;
}

.clear-all-btn {
  width: 100%;
  margin-top: 14px;
  padding: 10px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-btn-danger);
  background-color: var(--color-bg-btn-danger);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.clear-all-btn:hover {
  background-color: var(--color-bg-btn-danger-hover);
}

/* ---- 移动端：从左侧竖直抽屉改为顶部横向抽屉，避免固定宽度撑破窄屏 ---- */
@media (max-width: 768px) {
  .answer-card-drawer {
    width: 100%;
    max-height: none;
    min-height: 0;
  }

  .answer-card-drawer.is-collapsed {
    width: 100%;
    height: 40px;
  }

  .drawer-inner {
    flex: none;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    height: auto;
  }

  .drawer-trigger {
    width: 100%;
    height: 40px;
    flex-shrink: 0;
    border-right: none;
    border-bottom: 1px solid var(--color-border-divider);
  }

  .trigger-bar {
    flex-direction: row;
  }

  .trigger-text {
    writing-mode: horizontal-tb;
    letter-spacing: normal;
  }

  .drawer-content {
    flex: none;
    width: 100%;
    min-width: 0;
    max-height: 45vh;
  }

  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  }

  .card-button {
    width: auto;
    height: 38px;
  }
}
</style>
