<template>
  <section class="data-safety" aria-label="数据与备份" data-tour="backup-panel">
    <h3>数据与备份</h3>
    <p>数据版本 v{{ DATA_SCHEMA_VERSION }} · 应用 v{{ APP_VERSION_FALLBACK }}</p>
    <p class="location">{{ location }}</p>
    <p>全量备份包含题库、图片、错题本、错题记录、练习进度和显示偏好。不会包含 AI 配置、API Key 或会话密钥。远程图片仅保存链接，不代替远程服务备份。</p>
    <p>正常升级和覆盖安装自动沿用错题本，无需手动导入；原生端每个版本首次启动会保留升级前原件。卸载时请勿勾选删除应用数据；系统清理前请将备份另存到安全位置。备份不等于云同步。</p>
    <div class="actions">
      <button type="button" :disabled="busy" @click="exportBackup">{{ busy ? '正在处理…' : '导出全量备份' }}</button>
      <button type="button" :disabled="busy" @click="chooseBackup">选择备份恢复</button>
      <button type="button" :disabled="busy" @click="exportSnapshot">导出恢复前快照</button>
      <button type="button" :disabled="busy" @click="recoverNotebook">恢复最近错题快照</button>
    </div>
    <input ref="input" type="file" accept=".json,application/json" hidden @change="readBrowserBackup" />
    <div v-if="pending" class="preview">
      <strong>恢复预览 · {{ new Date(pending.payload.createdAt).toLocaleString() }}</strong>
      <p>{{ summary?.banks }} 个题库 · {{ summary?.images }} 张图片 · {{ summary?.notebooks }} 个错题本 · {{ summary?.sessions }} 份进度</p>
      <p>恢复将替换学习记录、设置和应用内题库；磁盘中同名题库/图片会覆盖，其他磁盘题库保留。支持同一运行环境恢复，不包含 AI 配置。当前数据将先保存为恢复前快照。</p>
      <div class="actions"><button type="button" :disabled="busy" @click="restore">确认恢复并重新加载</button><button type="button" :disabled="busy" @click="pending = null">取消</button></div>
    </div>
    <p v-if="message" role="status" :class="{ error: failed }">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { APP_VERSION_FALLBACK } from '../config/appInfo'
import { DATA_SCHEMA_VERSION, isNativeRuntime, persistenceError } from '../services/learningPersistence'
import { backupSummary, createFullBackup, readBeforeRestoreSnapshot, restoreFullBackup, validateFullBackup, type FullBackup } from '../services/fullBackup'
import { saveExportBlob } from '../services/fileService'
import { useQuizStore } from '../stores/quizStore'
import { showConfirm } from '../composables/useToast'
const store = useQuizStore()
const busy = ref(false)
const input = ref<HTMLInputElement | null>(null)
const message = ref('')
const failed = ref(false)
const location = ref('Web：当前站点的 localStorage（记录/设置）与 IndexedDB（导入题库/图片），请勿清理站点数据。')
const pending = ref<FullBackup | null>(null)
const summary = computed(() => pending.value ? backupSummary(pending.value) : null)
onMounted(async () => {
  if (isNativeRuntime()) {
    try { location.value = await invoke<string>('data_storage_info') } catch (error) { location.value = String(error) }
  }
  if (persistenceError) { failed.value = true; message.value = persistenceError }
})
async function run(action: () => Promise<void>, flush = true) {
  if (busy.value) return
  busy.value = true; failed.value = false; message.value = ''
  try {
    await store.persistedDataReady
    let warning = ''
    if (flush) {
      try { await store.flushSavedData() } catch (error) { warning = `本地保存未完成，操作基于可用副本：${String(error)}` }
    }
    await action()
    if (warning) message.value += '\n' + warning
  }
  catch (error) { failed.value = true; message.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
async function download(backup: FullBackup, prefix: string) {
  const saved = await saveExportBlob(`${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, new Blob([JSON.stringify(backup)], { type: 'application/json' }))
  message.value = saved ? '已导出备份，请妥善保管。文件不含 AI 配置与 API Key。' : '已取消导出。'
}
function exportBackup() { return run(async () => download(await createFullBackup(), 'biejuan-full-v2')) }
function exportSnapshot() { return run(async () => {
  const snapshot = await readBeforeRestoreSnapshot()
  if (!snapshot) throw new Error('暂无恢复前快照。第一次恢复前会自动保存。')
  await download(snapshot, 'biejuan-before-restore')
  if (snapshot.payload.rawSnapshot) message.value = '已导出原始数据保护快照。原数据存在损坏或无法完整导出，快照供排错保管，不能直接作为有效全量备份恢复。'
}) }
async function preview(text: string) { pending.value = await validateFullBackup(JSON.parse(text.replace(/^\uFEFF/, ''))); message.value = '校验通过，请确认恢复范围。' }
async function chooseBackup() {
  if (!isNativeRuntime()) { input.value?.click(); return }
  await run(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const selected = await open({ multiple: false, filters: [{ name: '全量备份 JSON', extensions: ['json'] }] })
    if (typeof selected === 'string') await preview(await readTextFile(selected))
  })
}
async function readBrowserBackup(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  if (file) await run(async () => { if (file.size > 256 * 1024 * 1024) throw new Error('备份超过 256 MB'); await preview(await file.text()) })
  element.value = ''
}
function restore() { return run(async () => {
  if (!pending.value || !await showConfirm('确认覆盖当前学习记录并恢复备份？请确保当前没有正在进行的文档转换。恢复成功后将重新加载应用。')) return
  await restoreFullBackup(pending.value)
  window.location.reload()
}) }
function recoverNotebook() { return run(async () => {
  const snapshot = isNativeRuntime()
    ? await invoke<string | null>('read_app_document', { name: 'quiz-data.json', previous: true })
    : localStorage.getItem('wrongNotebookData_v2.previous')
  if (!snapshot) throw new Error('暂无可恢复的错题快照。首次保存后将自动保留上一份数据。')
  if (!await showConfirm('仅恢复最近一次错题本快照，覆盖当前错题记录；题库和做题进度不变。确定继续？')) return
  const result = store.importAllDataFromJson(snapshot)
  if (!result.success) throw new Error(result.message)
  await store.flushSavedData()
  message.value = result.message
}, false) }
</script>

<style scoped>
.data-safety { margin-top: 22px; padding: 20px 0; border-top: 1px solid var(--color-border-divider); }
h3 { margin: 0 0 12px; }
p { color: var(--color-text-muted); font-size: .85rem; line-height: 1.7; }
.location { overflow-wrap: anywhere; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
button { padding: 10px 15px; border: 1px solid var(--color-border-divider); border-radius: 8px; background: var(--color-bg-container); color: var(--color-text-primary); cursor: pointer; font: inherit; font-size: .85rem; }
button:first-child { background: var(--color-accent); color: white; }
button:disabled { opacity: .5; cursor: wait; }
.preview { border: 1px solid var(--color-border-divider); border-radius: 10px; padding: 16px; margin-top: 16px; }
.error { color: #c43b3b; }
</style>
