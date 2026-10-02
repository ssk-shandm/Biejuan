<template>
  <div class="start-screen">
    <h2>别卷</h2>

    <div class="bank-selector">
      <label for="bank-select">选择题库：</label>
      <select id="bank-select" :value="selectedBank" :disabled="isRefreshingBanks || banks.length === 0" class="bank-select-input" @change="onBankChange">
        <option v-if="banks.length === 0" value="">暂无可用题库</option>
        <option v-for="bank in banks" :key="bank.file" :value="bank.file">{{ bank.name }}</option>
      </select>
      <button class="mode-btn refresh-bank-btn" type="button" :disabled="isRefreshingBanks" :aria-busy="isRefreshingBanks" @click="emit('refreshBanks')">
        {{ isRefreshingBanks ? '正在校验…' : '刷新题库' }}
      </button>
    </div>

    <slot />

    <p>请选择模式：</p>
    <div class="mode-buttons">
      <button class="mode-btn" @click="emit('start', 'exam')">考试模式</button>
      <button class="mode-btn" @click="emit('start', 'endorse')">背题模式</button>
      <button class="mode-btn" @click="emit('start', 'practice')">做题模式</button>
      <button class="mode-btn" @click="handleSpecialize">专项练习</button>
      <button class="mode-btn wrong-mode-btn" @click="emit('start', 'wrong-manage')">错题模式</button>
      <button class="mode-btn settings-mode-btn" @click="emit('start', 'settings')">⚙ 设置</button>

      <Transition name="slide-right">
        <div v-if="showSpecializePanel" class="specialize-panel">
          <p class="specialize-title">选择要练习的题型：</p>
          <label v-for="qt in availableQuestionTypes" :key="qt" class="specialize-option">
            <input v-model="selectedTypes" type="checkbox" :value="qt" />
            {{ qt }}
          </label>
          <div class="specialize-actions">
            <button class="mode-btn" :disabled="selectedTypes.length === 0" @click="confirmSpecialize">开始练习</button>
            <button class="mode-btn cancel-btn" @click="showSpecializePanel = false">取消</button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AppMode } from '../types'

const props = defineProps<{
  banks: { name: string; file: string }[]
  selectedBank: string
  questionTypes?: string[]
  isRefreshingBanks?: boolean
}>()

const emit = defineEmits<{
  (e: 'start', mode: Exclude<AppMode, 'start' | 'review' | 'about'>): void
  (e: 'start-specialize', types: string[]): void
  (e: 'changeBank', fileName: string): void
  (e: 'refreshBanks'): void
}>()

const showSpecializePanel = ref(false)
const selectedTypes = ref<string[]>([])
const availableQuestionTypes = computed(() => props.questionTypes ?? [])

function onBankChange(event: Event) {
  emit('changeBank', (event.target as HTMLSelectElement).value)
}

function handleSpecialize() {
  if (availableQuestionTypes.value.length === 0) {
    emit('start', 'specialize')
    return
  }
  selectedTypes.value = []
  showSpecializePanel.value = true
}

function confirmSpecialize() {
  if (selectedTypes.value.length === 0) return
  showSpecializePanel.value = false
  emit('start-specialize', [...selectedTypes.value])
}
</script>

<style scoped>
.start-screen { text-align: center; color: var(--color-text-primary); }
.start-screen h2 { margin-top: 0; }
.bank-selector { margin-bottom: 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px; }
.bank-selector label { font-weight: 600; color: var(--color-text-secondary); }
.bank-select-input { padding: 8px 12px; font-size: 1rem; border-radius: 6px; border: 1px solid var(--color-border-input); background: var(--color-bg-input); color: var(--color-text-input); }
.mode-buttons { position: relative; display: flex; flex-direction: column; gap: 15px; width: 100%; max-width: 300px; margin: 20px auto 0; }
.mode-btn { padding: 14px; font-size: 1.1rem; border: 1px solid var(--color-border-btn-mode); border-radius: 8px; background: var(--color-bg-btn-mode); color: var(--color-text-btn-mode); cursor: pointer; transition: all .2s; font-weight: 600; }
.mode-btn:hover { background: var(--color-bg-btn-mode-hover); transform: translateY(-2px); box-shadow: 0 4px 6px rgba(0,0,0,.1); }
.mode-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.refresh-bank-btn { padding: 8px 12px; font-size: .95rem; }
.wrong-mode-btn { background: var(--color-bg-btn-wrong-mode); color: var(--color-text-btn-wrong-mode); border-color: var(--color-border-btn-wrong-mode); }
.wrong-mode-btn:hover { background: var(--color-bg-btn-wrong-mode-hover); }
.settings-mode-btn { border-style: dashed; }
.specialize-panel { position: absolute; left: calc(100% + 24px); top: 0; width: 240px; padding: 20px; box-sizing: border-box; border: 1px solid var(--color-border-container); border-radius: 10px; background: var(--color-bg-surface); box-shadow: 0 8px 24px rgba(0,0,0,.15); text-align: left; z-index: 20; }
.specialize-title { font-weight: 600; margin: 0 0 12px; }
.specialize-option { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: .95rem; cursor: pointer; }
.specialize-option input { accent-color: var(--color-accent); }
.specialize-actions { display: flex; gap: 12px; margin-top: 16px; }
.specialize-actions .mode-btn { flex: 1; padding: 10px; font-size: .92rem; }
.cancel-btn { background: var(--color-bg-btn-secondary) !important; color: var(--color-text-btn-secondary) !important; }
.slide-right-enter-active, .slide-right-leave-active { transition: all .25s ease; }
.slide-right-enter-from, .slide-right-leave-to { opacity: 0; transform: translateX(20px); }
@media (max-width: 768px) { .specialize-panel { left: 0; top: 100%; width: 100%; margin-top: 12px; } }
</style>
