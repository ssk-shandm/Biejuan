<template>
  <aside class='runtime-terminal' aria-label='运行终端'>
    <div class='terminal-bar'>
      <div class='terminal-title'>
        <span class='terminal-prompt' aria-hidden='true'>&gt;_</span>
        <span>运行终端</span>
        <span class='terminal-count'>{{ runtimeLogs.length }}</span>
      </div>
      <div class='terminal-actions'>
        <button class='terminal-save' type='button' :disabled='runtimeLogs.length === 0 || isSaving' :aria-busy='isSaving' @click='handleSave'>{{ isSaving ? '打包中...' : '打包保存日志' }}</button>
        <button class='terminal-clear' type='button' :disabled='runtimeLogs.length === 0 || isSaving' @click='clearRuntimeLogs'>清空</button>
      </div>
    </div>
    <p v-if='exportMessage' class='terminal-export-message' role='status'>{{ exportMessage }}</p>
    <div ref='output' class='terminal-output' role='log' aria-live='polite'>
      <div v-if='runtimeLogs.length === 0' class='terminal-empty'>暂无运行信息</div>
      <div v-for='entry in runtimeLogs' :key='entry.id' class='terminal-line' :data-level='entry.level'>
        <time>{{ entry.timestamp }}</time>
        <strong>{{ levelLabel(entry.level) }}</strong>
        <span>{{ entry.message }}</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang='ts'>
import { nextTick, ref, watch } from 'vue'
import { useRuntimeConsole, type RuntimeLogLevel } from '../composables/useRuntimeConsole'

const { runtimeLogs, clearRuntimeLogs, saveRuntimeLogs } = useRuntimeConsole()
const output = ref<HTMLElement | null>(null)
const isSaving = ref(false)
const exportMessage = ref('')

function levelLabel(level: RuntimeLogLevel) {
  return { info: '信息', warn: '警告', error: '错误' }[level]
}

async function handleSave() {
  if (isSaving.value || runtimeLogs.value.length === 0) return
  isSaving.value = true
  exportMessage.value = ''
  try {
    const saved = await saveRuntimeLogs()
    exportMessage.value = saved ? '日志已打包导出，请在保存位置查看。' : '已取消保存日志。'
  } catch (error) {
    exportMessage.value = `日志保存失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    isSaving.value = false
  }
}

watch(runtimeLogs, async () => {
  await nextTick()
  if (output.value) output.value.scrollTop = output.value.scrollHeight
}, { deep: true })
</script>

<style scoped>
.runtime-terminal { width: 100%; height: 100%; min-height: 0; display: flex; box-sizing: border-box; flex-direction: column; overflow: hidden; color: #d8e2f0; background: #101722; border: 1px solid rgba(148, 163, 184, .24); border-radius: 12px; box-shadow: 0 8px 24px rgba(9, 16, 28, .12); font-family: Consolas, 'Courier New', monospace; }
.terminal-bar { display: flex; align-items: center; justify-content: space-between; min-height: 42px; padding: 0 14px; border-bottom: 1px solid rgba(148, 163, 184, .24); }
.terminal-title { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 8px 0; font-size: .82rem; font-weight: 700; }
.terminal-actions { display: flex; align-items: center; gap: 4px; }
.terminal-clear { border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.terminal-save { border: 0; padding: 6px 8px; color: #5eead4; background: transparent; font: inherit; font-size: .74rem; cursor: pointer; }
.terminal-prompt { color: #5eead4; }
.terminal-count { color: #94a3b8; font-size: .75rem; font-weight: 400; }
.terminal-clear { padding: 6px 8px; color: #94a3b8; font-size: .74rem; }
.terminal-clear:hover:not(:disabled) { color: #f8fafc; }
.terminal-save:hover:not(:disabled) { color: #ccfbf1; }
.terminal-clear:disabled { cursor: not-allowed; opacity: .45; }
.terminal-save:disabled { cursor: not-allowed; opacity: .45; }
.terminal-export-message { margin: 0; padding: 5px 14px; color: #94a3b8; border-bottom: 1px solid rgba(148, 163, 184, .16); font-size: .7rem; }
.terminal-output { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 18px; border-top: 1px solid rgba(148, 163, 184, .16); background: #0b111b; font-size: .75rem; line-height: 1.55; }
.terminal-line { display: grid; grid-template-columns: 82px 52px minmax(0, 1fr); gap: 9px; padding: 2px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.terminal-line time { color: #64748b; }
.terminal-line strong { color: #93c5fd; font-size: .68rem; }
.terminal-line span { color: #d8e2f0; }
.terminal-line[data-level='warn'] strong { color: #fbbf24; }
.terminal-line[data-level='warn'] span { color: #fde68a; }
.terminal-line[data-level='error'] strong { color: #fb7185; }
.terminal-line[data-level='error'] span { color: #fecdd3; }
.terminal-empty { color: #64748b; }
@media (max-width: 620px) {
  .terminal-bar { padding: 0 10px; }
  .terminal-output { padding: 12px 10px 14px; }
  .terminal-line { grid-template-columns: 68px 46px minmax(0, 1fr); gap: 6px; font-size: .7rem; }
}
</style>
