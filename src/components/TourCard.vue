<template>
  <div class="tour-card">
    <div class="tour-label-head">
      <span class="tour-step-count">新手指引 <span>{{ index + 1 }} / {{ total }}</span></span>
      <button class="tour-close" type="button" aria-label="退出指引" @click="emit('finish')">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>
    </div>
    <div aria-live="polite" aria-atomic="true">
      <h3 :id="measurement ? undefined : `tour-title-${step.key}`" class="tour-title">{{ step.title }}</h3>
      <p :id="measurement ? undefined : `tour-desc-${step.key}`" class="tour-desc">{{ step.description }}</p>
      <ul v-if="step.points?.length" class="tour-points">
        <li v-for="point in step.points" :key="point">{{ point }}</li>
      </ul>
    </div>
    <div class="tour-actions">
      <button class="tour-btn skip" type="button" @click="emit('finish')">跳过指引</button>
      <div class="tour-nav">
        <button v-if="index > 0" class="tour-btn ghost" type="button" :disabled="preparing" @click="emit('prev')">上一步</button>
        <button class="tour-btn primary" type="button" :disabled="preparing" @click="emit('next')">{{ index === total - 1 ? '完成' : '下一步' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TourStep } from '../types'
defineProps<{ step: TourStep; index: number; total: number; preparing: boolean; measurement?: boolean }>()
const emit = defineEmits<{ finish: []; next: []; prev: [] }>()
</script>

<style scoped>
.tour-card { box-sizing: border-box; padding: 22px; }
.tour-label-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.tour-step-count { display: flex; align-items: center; gap: 12px; color: var(--color-text-secondary); font-size: .75rem; }
.tour-step-count > span { font-variant-numeric: tabular-nums; }
.tour-close { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; color: var(--color-text-secondary); background: transparent; cursor: pointer; }
.tour-close:hover { color: var(--color-text-primary); background: var(--color-bg-surface-hover); }
.tour-title { margin: 0 0 10px; font-size: 1.08rem; line-height: 1.5; font-weight: 600; }
.tour-desc { margin: 0; color: var(--color-text-secondary); font-size: .875rem; line-height: 1.8; }
.tour-points { display: grid; gap: 6px; margin: 12px 0 0; padding-left: 18px; color: var(--color-text-secondary); font-size: .8rem; line-height: 1.75; }
.tour-points li::marker { color: var(--color-border-input); }
.tour-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--color-border-container); }
.tour-nav { display: flex; gap: 8px; }
.tour-btn { min-height: 36px; padding: 7px 12px; border: 1px solid transparent; border-radius: 6px; font: inherit; font-size: .8rem; line-height: 1.4; white-space: nowrap; cursor: pointer; }
.tour-btn.primary { background: var(--color-bg-btn-mode); color: var(--color-text-btn-mode); border-color: var(--color-border-btn-mode); }
.tour-btn.primary:hover:not(:disabled) { background: var(--color-bg-btn-mode-hover); }
.tour-btn:disabled { opacity: .5; cursor: wait; }
.tour-btn.ghost { background: transparent; color: var(--color-text-primary); border-color: var(--color-border-container); }
.tour-btn.ghost:hover { background: var(--color-bg-surface-hover); }
.tour-btn.skip { padding-inline: 0; color: var(--color-text-secondary); background: transparent; }
.tour-btn.skip:hover { color: var(--color-text-primary); }
.tour-btn:focus-visible, .tour-close:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }
@media (max-width: 639px) { .tour-card { padding: 18px; } }
@media (max-width: 360px) { .tour-card { padding: 14px; } .tour-btn { padding-inline: 8px; } }
</style>
