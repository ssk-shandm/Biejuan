<template>
  <Teleport to="body">
    <TransitionGroup
      name="global-notice"
      tag="div"
      class="global-notice-list"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        v-for="notice in globalToasts"
        :key="notice.id"
        class="global-notice"
        :class="`global-notice-${notice.kind}`"
        role="status"
      >
        <span class="global-notice-icon" aria-hidden="true">{{ noticeIcon(notice.kind) }}</span>
        <span class="global-notice-message">{{ notice.message }}</span>
        <button
          type="button"
          class="global-notice-close"
          aria-label="关闭通知"
          @click="dismissGlobalToast(notice.id)"
        >
          ×
        </button>
      </div>
    </TransitionGroup>

    <Transition name="toast-fade">
      <div
        v-if="toasts.length > 0"
        ref="overlayRef"
        class="toast-overlay"
        tabindex="-1"
        @click.self="dismissTop"
        @keydown.enter.prevent="dismissTop"
      >
        <TransitionGroup name="toast-pop">
          <div
            v-for="t in toasts"
            :key="t.id"
            class="toast-box"
          >
            <p class="toast-msg">{{ t.message }}</p>
            <div v-if="t.isConfirm" class="toast-actions">
              <button class="toast-btn toast-cancel" @click.stop="dismiss(t.id)">取消</button>
              <button class="toast-btn toast-ok" @click.stop="confirm(t.id)">确定</button>
            </div>
            <button v-else class="toast-btn toast-ok toast-sole" @click.stop="dismiss(t.id)">确定</button>
          </div>
        </TransitionGroup>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  useToastList,
  useGlobalToastList,
  dismissToast,
  dismissGlobalToast,
  confirmToast,
} from '../composables/useToast'
import type { GlobalToastKind } from '../composables/useToast'

const toasts = useToastList()
const globalToasts = useGlobalToastList()
const overlayRef = ref<HTMLElement | null>(null)

watch(() => toasts.value.length, (len) => {
  if (len > 0) setTimeout(() => overlayRef.value?.focus(), 0)
})

function dismiss(id: number) {
  dismissToast(id)
}

function confirm(id: number) {
  confirmToast(id)
}

function dismissTop() {
  const top = toasts.value[toasts.value.length - 1]
  if (top) dismissToast(top.id)
}

function noticeIcon(kind: GlobalToastKind) {
  return kind === 'success' ? '✓' : kind === 'error' ? '!' : 'i'
}
</script>

<style scoped>
.global-notice-list {
  position: fixed;
  top: max(20px, env(safe-area-inset-top));
  right: max(20px, env(safe-area-inset-right));
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  width: min(420px, calc(100vw - 40px));
  pointer-events: none;
}

.global-notice {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 13px 14px;
  border: 1px solid var(--color-border-container, rgba(0, 0, 0, 0.08));
  border-left: 4px solid var(--notice-accent, #4a90d9);
  border-radius: 10px;
  background: var(--color-bg-container, #fff);
  color: var(--color-text-primary, #333);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
  line-height: 1.45;
}

.global-notice-success { --notice-accent: #27ae60; }
.global-notice-error { --notice-accent: #d64545; }
.global-notice-info { --notice-accent: #4a90d9; }

.global-notice-icon {
  display: inline-flex;
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--notice-accent);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
}

.global-notice-message {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.global-notice-close {
  flex: 0 0 auto;
  border: 0;
  padding: 2px 4px;
  background: transparent;
  color: var(--color-text-muted, #888);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}

.global-notice-close:hover { color: var(--color-text-primary, #333); }

.global-notice-enter-active,
.global-notice-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.global-notice-enter-from,
.global-notice-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
.global-notice-move { transition: transform 0.2s ease; }

.toast-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.toast-box {
  background: var(--color-bg-container, #fff);
  border-radius: 12px;
  padding: 28px 32px 20px;
  max-width: 420px;
  width: 85%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  text-align: center;
}

.toast-msg {
  margin: 0 0 20px;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text-primary, #333);
  white-space: pre-wrap;
}

.toast-actions { display: flex; gap: 12px; justify-content: center; }

.toast-btn {
  padding: 10px 32px;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.toast-btn:hover { transform: translateY(-1px); }
.toast-ok { background: var(--color-bg-btn-primary, #4a90d9); color: var(--color-text-btn-primary, #fff); }
.toast-cancel { background: var(--color-bg-btn-secondary, #e0e0e0); color: var(--color-text-btn-secondary, #666); }
.toast-sole { min-width: 120px; }

.toast-fade-enter-active,
.toast-fade-leave-active { transition: opacity 0.2s ease; }
.toast-fade-enter-from,
.toast-fade-leave-to { opacity: 0; }
.toast-pop-enter-active { transition: all 0.25s ease-out; }
.toast-pop-leave-active { transition: all 0.15s ease-in; }
.toast-pop-enter-from { opacity: 0; transform: scale(0.9) translateY(10px); }
.toast-pop-leave-to { opacity: 0; transform: scale(0.95); }

@media (max-width: 600px) {
  .global-notice-list {
    top: max(12px, env(safe-area-inset-top));
    right: 12px;
    width: calc(100vw - 24px);
  }
}
</style>
