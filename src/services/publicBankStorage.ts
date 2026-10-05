import { invoke } from '@tauri-apps/api/core'
import { usePlatform } from '../composables/usePlatform'
import { normalizeQuestionBank } from '../utils/questionSchema'
import { GENERATED_BANK_PREFIX, deleteGeneratedBanks } from './generatedBankStorage'
import { PUBLIC_BANKS_CHANGED } from './publicBankWriter'

export interface PublicBankEntry {
  name: string
  file: string
  deletable?: boolean
}

export async function listPublicBanks(): Promise<PublicBankEntry[]> {
  if (usePlatform().isDesktopTauri.value) {
    return invoke<PublicBankEntry[]>('list_question_banks')
  }
  const response = await fetch(`/subjects/banks.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`无法读取题库清单（HTTP ${response.status}）`)
  const entries: unknown = await response.json()
  if (!Array.isArray(entries) || entries.some((entry) =>
    !entry || typeof entry.name !== 'string' || typeof entry.file !== 'string',
  )) {
    throw new Error('题库清单格式不正确')
  }
  return entries as PublicBankEntry[]
}

export async function readPublicBank(file: string, name = file) {
  let text: string
  if (usePlatform().isDesktopTauri.value) {
    text = await invoke<string>('read_question_bank', { file })
  } else {
    const response = await fetch(`${file}?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`无法读取文件（HTTP ${response.status}）`)
    text = await response.text()
  }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('JSON 语法错误，请检查文件内容并使用 UTF-8 编码保存')
  }
  const questions = normalizeQuestionBank(raw, name)
  if (questions.length === 0) throw new Error('题库中没有题目')
  return questions
}

/** File permissions come from the desktop backend; do not infer them from origin labels. */
export function isBankDeletable(bank: PublicBankEntry): boolean {
  return bank.file.startsWith(GENERATED_BANK_PREFIX) || bank.deletable === true
}

export async function deleteManagedBanks(banks: PublicBankEntry[]) {
  const deleted: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const bank of banks) {
    if (seen.has(bank.file)) continue
    seen.add(bank.file)
    try {
      if (!isBankDeletable(bank)) throw new Error('该题库为只读，不能删除')
      if (bank.file.startsWith(GENERATED_BANK_PREFIX)) {
        await deleteGeneratedBanks([bank.file], false)
      } else {
        if (!usePlatform().isDesktopTauri.value) throw new Error('当前环境不支持删除本地题库文件')
        await invoke('delete_question_bank', { file: bank.file })
      }
      deleted.push(bank.file)
    } catch (error) {
      errors.push('「' + bank.name + '」：' + (error instanceof Error ? error.message : String(error)))
    }
  }
  if (deleted.length) window.dispatchEvent(new CustomEvent(PUBLIC_BANKS_CHANGED))
  return { deleted, errors }
}
