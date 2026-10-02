import { invoke } from '@tauri-apps/api/core'
import { usePlatform } from '../composables/usePlatform'
import { normalizeQuestionBank } from '../utils/questionSchema'

export interface PublicBankEntry {
  name: string
  file: string
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
