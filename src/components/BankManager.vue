<template>
  <section class="bank-manager" aria-label="当前题库">
    <BankImportPanel />
    <div data-tour="bank-manage">
    <div class="bank-manager-heading">
      <div>
        <h4>当前题库（{{ banks.length }}）</h4>
        <p>用户题库目录中的手动 JSON、AI 转换和导入题库均可删除；安装包资源目录中的题库保持只读。删除会移除 JSON 和关联练习记录，不删除可能共享的图片。</p>
      </div>
    </div>
    <p v-if="!banks.length" class="bank-manager-empty">暂无题库。</p>
    <div v-else class="bank-manager-list">
      <label v-for="bank in banks" :key="bank.file" class="bank-manager-row" :class="{ disabled: !isBankDeletable(bank) }">
        <input v-model="selected" type="checkbox" :value="bank.file" :disabled="deleting || !isBankDeletable(bank)" />
        <span class="bank-manager-name">{{ bank.name }} <small v-if="bank.file === selectedBank">当前选中</small></span>
        <span class="bank-manager-kind">{{ bankSourceLabel(bank.file, isDevelopment) }}</span>
      </label>
    </div>
    <div class="bank-manager-footer">
      <span>已选 {{ selected.length }} 个</span>
      <button type="button" class="bank-manager-delete" :disabled="!selected.length || deleting" @click="removeSelected">
        {{ deleting ? '正在删除…' : '删除所选题库' }}
      </button>
    </div>
    <p v-if="message" class="bank-manager-status" :class="{ error: failed }" role="status">{{ message }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import BankImportPanel from './BankImportPanel.vue'
import { ref, watch } from 'vue'
import type { BankEntry } from '../composables/useQuiz'
import { deleteManagedBanks, isBankDeletable } from '../services/publicBankStorage'
import { showConfirm } from '../composables/useToast'
import { useQuizStore } from '../stores/quizStore'
import { isBankSessionKey } from '../utils/bankSessionKeys'
import { bankSourceLabel, forgetBankSources } from '../services/bankSources'
const isDevelopment = import.meta.env.DEV

const props = defineProps<{ banks: BankEntry[]; selectedBank: string }>()
const store = useQuizStore()
const selected = ref<string[]>([])
const deleting = ref(false)
const message = ref('')
const failed = ref(false)

watch(() => props.banks, banks => {
  const available = new Set(banks.filter(isBankDeletable).map(bank => bank.file))
  selected.value = selected.value.filter(file => available.has(file))
})

async function removeSelected() {
  if (deleting.value || !selected.value.length) return
  const files = selected.value.filter(file => props.banks.some(bank => bank.file === file && isBankDeletable(bank)))
  if (!files.length) return
  const fileSet = new Set(files)
  const notebooks = store.notebooks.filter(notebook => fileSet.has(notebook.bankFile)).length
  const wrongAnswers = store.wrongEntries.filter(entry => fileSet.has(entry.bankFile)).length
  const accepted = await showConfirm(`确定删除 ${files.length} 个题库吗？这会永久删除这些题库的 ${notebooks} 个错题本及相关 ${wrongAnswers} 条错题记录和练习进度，无法撤销。建议先备份错题本。`)
  if (!accepted) return
  deleting.value = true
  message.value = ''
  try {
    const notebookIds = store.notebooks.map(notebook => notebook.id)
    const result = await deleteManagedBanks(props.banks.filter(bank => fileSet.has(bank.file)))
    if (result.deleted.length) await store.removeBanksData(result.deleted)
    forgetBankSources(result.deleted)
    for (const file of result.deleted) {
      for (const key of Object.keys(localStorage)) {
        if (isBankSessionKey(key, localStorage.getItem(key), file, notebookIds)) localStorage.removeItem(key)
      }
    }
    selected.value = selected.value.filter(file => !result.deleted.includes(file))
    failed.value = result.errors.length > 0
    message.value = [
      result.deleted.length ? `已删除 ${result.deleted.length} 个题库及其关联错题记录。` : '',
      ...result.errors,
    ].filter(Boolean).join('\n')
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : '删除题库失败，请重试。'
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.bank-manager { margin-top: 22px; border-top: 1px solid var(--color-border-divider); padding-top: 20px; }
.bank-manager-heading h4 { margin: 0 0 7px; font-size: 1rem; }
.bank-manager-heading p, .bank-manager-empty { margin: 0 0 14px; color: var(--color-text-muted); font-size: .82rem; line-height: 1.5; }
.bank-manager-list { max-height: 250px; overflow-y: auto; border: 1px solid var(--color-border-divider); border-radius: 10px; }
.bank-manager-row { display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--color-border-divider); cursor: pointer; }
.bank-manager-row:last-child { border-bottom: 0; }
.bank-manager-row.disabled { opacity: .65; cursor: not-allowed; }
.bank-manager-row input { width: 17px; height: 17px; flex: 0 0 auto; accent-color: var(--color-accent); }
.bank-manager-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.bank-manager-name small { color: var(--color-accent); font-size: .72rem; }
.bank-manager-kind { color: var(--color-text-muted); font-size: .73rem; white-space: nowrap; }
.bank-manager-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; font-size: .8rem; }
.bank-manager-delete { border: 0; border-radius: 8px; padding: 10px 14px; background: #ba3434; color: white; cursor: pointer; font: inherit; }
.bank-manager-delete:disabled { opacity: .5; cursor: not-allowed; }
.bank-manager-status { margin-bottom: 0; color: var(--color-accent); font-size: .82rem; }
.bank-manager-status.error { color: #d44; }
</style>
