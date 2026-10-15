<template>
  <section class="bank-import" aria-label="导入题库">
    <button type="button" :disabled="busy" @click="choose">导入 JSON 题库</button>
    <input ref="input" type="file" accept=".json,application/json" hidden @change="readFile" />
    <div v-if="inspection" class="preview">
      <strong>{{ inspection.name }}</strong>
      <p>{{ inspection.questions.length }} 道可识别题目 · {{ inspection.imageCount }} 张引用图片</p>
      <p>{{ Object.entries(inspection.types).map(([type, count]) => `${type} ${count}`).join(' · ') }}</p>
      <template v-if="inspection.issues.length">
        <p class="error">发现 {{ inspection.issues.length }} 个问题，尚未保存。修复后请重新选择文件。</p>
        <pre>{{ bankIssueReport(inspection) }}</pre>
        <button type="button" @click="exportReport">导出问题报告</button>
      </template>
      <template v-else>
        <p>校验通过。引用图片须已在图库中或使用内嵌图片；本入口不会从 JSON 文件所在目录自动复制图片。原文件不会被修改，同名题库不会覆盖。</p>
        <button type="button" :disabled="busy" @click="confirm">确认导入</button>
      </template>
      <button type="button" :disabled="busy" @click="inspection = null">取消</button>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { inspectBank, bankIssueReport, type BankInspection } from '../utils/bankImport'
import { isNativeRuntime } from '../services/learningPersistence'
import { savePublicBank } from '../services/publicBankWriter'
import { saveExportBlob } from '../services/fileService'
const input = ref<HTMLInputElement | null>(null)
const inspection = ref<BankInspection | null>(null)
const busy = ref(false)
const message = ref('')
function inspect(text: string, name: string) { inspection.value = inspectBank(text, name); message.value = '' }
async function choose() {
  if (!isNativeRuntime()) { input.value?.click(); return }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({ multiple: false, filters: [{ name: '题库 JSON', extensions: ['json'] }] })
    if (typeof path === 'string') inspect(await readTextFile(path), path.replace(/\\/g, '/').split('/').pop() || '题库.json')
  } catch (error) { message.value = String(error) }
}
async function readFile(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  try { if (file) { if (file.size > 16 * 1024 * 1024) throw new Error('题库超过 16 MB'); inspect(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()), file.name) } }
  catch (error) { message.value = String(error) }
  finally { element.value = '' }
}
async function confirm() {
  if (busy.value || !inspection.value || inspection.value.issues.length) return
  busy.value = true
  try {
    const bank = inspection.value
    const result = await savePublicBank(bank.name.replace(/\.json$/i, ''), `import-${crypto.randomUUID()}`, bank.content, [], true, 'import')
    message.value = `已导入 ${bank.questions.length} 道题。保存位置：${result.location}`
    inspection.value = null
  } catch (error) { message.value = `导入失败，原文件未改变：${String(error)}` }
  finally { busy.value = false }
}
async function exportReport() {
  if (!inspection.value) return
  try { await saveExportBlob('bank-import-report.txt', new Blob([bankIssueReport(inspection.value)], { type: 'text/plain;charset=utf-8' })) }
  catch (error) { message.value = String(error) }
}
</script>
<style scoped>
.bank-import { margin-bottom: 22px; }
button { margin: 4px 8px 4px 0; border: 1px solid var(--color-border-divider); border-radius: 8px; padding: 10px 14px; background: var(--color-bg-container); color: var(--color-text-primary); font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: wait; }
.preview { border: 1px solid var(--color-border-divider); border-radius: 10px; padding: 16px; margin-top: 12px; overflow-wrap: anywhere; }
p { font-size: .83rem; line-height: 1.6; color: var(--color-text-muted); }
pre { white-space: pre-wrap; max-height: 220px; overflow-y: auto; font-size: .8rem; }
.error { color: #c43b3b; }
</style>
