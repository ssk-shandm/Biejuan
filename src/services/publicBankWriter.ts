import { invoke } from '@tauri-apps/api/core'
import { usePlatform } from '../composables/usePlatform'
import type { DocumentImageAsset } from '../utils/documentAssets'
import { inspectBank, bankIssueReport } from '../utils/bankImport'
import { readBankSources, rememberBankSource, type BankSource } from './bankSources'
import { deleteGeneratedBanks, listGeneratedBanks, readStoredGeneratedBank, saveGeneratedBank } from './generatedBankStorage'

export const PUBLIC_BANKS_CHANGED = 'public-banks-changed'

export interface PublicBankSaveResult {
  file: string
  location: string
  /** 不阻断保存的提示，例如题目暂时没有答案 */
  warnings: string[]
}

function canWritePublicBank() {
  return usePlatform().isDesktopTauri.value || (import.meta.env.DEV && usePlatform().platform.value === 'web')
}

async function imageToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function savePublicBank(name: string, directory: string, content: string, images: Pick<DocumentImageAsset, 'fileName' | 'blob'>[], notify = true, source: BankSource = 'ai'): Promise<PublicBankSaveResult> {
  if (localStorage.getItem('exam-restore-pending')) throw new Error('正在恢复学习数据，请完成恢复后再保存题库。转换结果请先导出保管。')
  // AI 转换允许题目暂时没有答案，缺答案只作为提示返回，由调用方在终端逐题说明；
  // 人工导入（source 为 import）仍保持严格校验，缺答案直接拒绝。
  const allowMissingAnswers = source !== 'import'
  const inspection = inspectBank(content, name, { allowMissingAnswers })
  if (inspection.issues.length) throw new Error(bankIssueReport(inspection))
  const warnings = inspection.warnings.map(item => `${item.question}：${item.reason}`)
  if (!canWritePublicBank()) {
    const file = await saveGeneratedBank(name, directory, content, images)
    rememberBankSource(file, source)
    return { file, location: '应用内存储（此运行环境无法写入本地 public 目录）', warnings }
  }
  const payload = {
    name, directory, content,
    images: await Promise.all(images.map(async image => ({ fileName: image.fileName, data: await imageToBase64(image.blob) }))),
  }
  let result: PublicBankSaveResult
  if (usePlatform().isDesktopTauri.value) {
    result = await invoke<PublicBankSaveResult>('save_question_bank', { payload })
  } else {
    const response = await fetch('/api/question-banks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || `保存题库失败（HTTP ${response.status}）`)
    result = data as PublicBankSaveResult
  }
  rememberBankSource(result.file, source)
  if (notify) window.dispatchEvent(new CustomEvent<string>(PUBLIC_BANKS_CHANGED, { detail: result.file }))
  return { ...result, warnings }
}

let migration: Promise<string[]> | null = null

export function migrateGeneratedBanksToPublic(): Promise<string[]> {
  if (!canWritePublicBank()) return Promise.resolve([])
  if (migration) return migration
  migration = (async () => {
    const warnings: string[] = []
    for (const entry of await listGeneratedBanks()) {
      try {
        // Keep established identities until a future stable-ID migration can move every reference.
        const hasHistory = Object.keys(localStorage).some(key => key.includes(entry.file))
          || (localStorage.getItem('wrongNotebookData_v2') ?? '').includes(JSON.stringify(entry.file))
        if (hasHistory) continue
        const bank = await readStoredGeneratedBank(entry.file)
        const directory = decodeURIComponent(entry.file.slice('generated:'.length))
        const result = await savePublicBank(bank.name, directory, bank.content, bank.images, false, readBankSources()[entry.file] ?? 'legacy')
        if (localStorage.getItem('lastBank') === entry.file) localStorage.setItem('lastBank', result.file)
        await deleteGeneratedBanks([entry.file], false)
      } catch (error) {
        warnings.push(`「${entry.name}」写入本地题库目录失败，原题库仍保留：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return warnings
  })().finally(() => { migration = null })
  return migration
}
