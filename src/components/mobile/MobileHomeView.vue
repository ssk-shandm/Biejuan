<template>
  <template v-if="isLoading">
    <section class="mobile-panel" role="status">题库加载中...</section>
  </template>
  <template v-else>
    <section class="mobile-panel mobile-home-bank-card">
      <div class="mobile-section-heading">
        <div><span class="mobile-section-eyebrow">LIBRARY</span><h2>选择题库</h2></div>
        <span class="mobile-section-mark" aria-hidden="true">▤</span>
      </div>
      <select class="mobile-select" aria-label="选择题库" :value="currentBankFile" @change="onBankChange">
        <option v-for="bank in allBanks" :key="bank.file" :value="bank.file">{{ bank.name }}</option>
      </select>
      <button class="mobile-action mobile-home-import" type="button" @click="$emit('importBank')">导入 JSON 题库</button>
      <p class="mobile-muted">{{ availableQuestionTypes.length }} 类题型 · {{ questionCount }} 道题</p>
    </section>
    <section class="mobile-panel mobile-mode-list mobile-home-learning-card" aria-label="学习模式">
      <div class="mobile-section-heading">
        <div><span class="mobile-section-eyebrow">YOUR ROUTINE</span><h2>开始学习</h2></div>
        <span class="mobile-section-mark mobile-section-mark-accent" aria-hidden="true">✦</span>
      </div>
      <button class="mobile-action mobile-primary" type="button" @click="$emit('start', 'practice')">做题练习 →</button>
      <button class="mobile-action" type="button" @click="$emit('start', 'exam')">模拟考试 →</button>
      <button class="mobile-action" type="button" @click="$emit('start', 'endorse')">背题模式 →</button>
      <button class="mobile-action" type="button" @click="showTypes = !showTypes">专项练习 {{ showTypes ? '⌃' : '⌄' }}</button>
      <div v-if="showTypes" class="mobile-mode-list">
        <label v-for="type in availableQuestionTypes" :key="type" class="mobile-action">
          <input v-model="selectedTypes" type="checkbox" :value="type" /> {{ type }}
        </label>
        <button class="mobile-action mobile-primary" type="button" :disabled="!selectedTypes.length" @click="startSpecialize">开始专项</button>
      </div>
      <button class="mobile-action" type="button" :disabled="wrongCount === 0" @click="$emit('start', 'wrong')">错题练习（{{ wrongCount }}） →</button>
    </section>
  </template>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AppMode } from '../../types'
import type { BankEntry } from '../../composables/useQuiz'

defineProps<{
  isLoading: boolean
  allBanks: BankEntry[]
  currentBankFile: string
  availableQuestionTypes: string[]
  questionCount: number
  wrongCount: number
}>()
const emit = defineEmits<{
  (event: 'bankChange', fileName: string): void
  (event: 'importBank'): void
  (event: 'start', mode: AppMode): void
  (event: 'startSpecialize', types: string[]): void
}>()
const showTypes = ref(false)
const selectedTypes = ref<string[]>([])
function onBankChange(event: Event) {
  emit('bankChange', (event.target as HTMLSelectElement).value)
}
function startSpecialize() {
  if (!selectedTypes.value.length) return
  emit('startSpecialize', [...selectedTypes.value])
  showTypes.value = false
}
</script>
