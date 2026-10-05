import { invoke } from '@tauri-apps/api/core'
import { usePlatform } from '../composables/usePlatform'
import type { DocumentImageAsset } from '../utils/documentAssets'
import { normalizeQuestionBank } from '../utils/questionSchema'
import { deleteGeneratedBanks, listGeneratedBanks, readStoredGeneratedBank, saveGeneratedBank } from './generatedBankStorage'

export const PUBLIC_BANKS_CHANGED = 'public-banks-changed'

export interface PublicBankSaveResult {
  file: string
  location: string
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

export async function savePublicBank(name: string, directory: string, content: string, images: Pick<DocumentImageAsset, 'fileName' | 'blob'>[], notify = true): Promise<PublicBankSaveResult> {
  if (!normalizeQuestionBank(JSON.parse(content), name).length) throw new Error('题库中没有有效题目')
  if (!canWritePublicBank()) {
    const file = await saveGeneratedBank(name, directory, content, images)
    return { file, location: '应用内存储（此运行环境无法写入本地 public 目录）' }
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
  if (notify) window.dispatchEvent(new CustomEvent<string>(PUBLIC_BANKS_CHANGED, { detail: result.file }))
  return result
}

let migration: Promise<string[]> | null = null

export function migrateGeneratedBanksToPublic(): Promise<string[]> {
  if (!canWritePublicBank()) return Promise.resolve([])
  if (migration) return migration
  migration = (async () => {
    const warnings: string[] = []
    for (const entry of await listGeneratedBanks()) {
      try {
        const bank = await readStoredGeneratedBank(entry.file)
        const directory = decodeURIComponent(entry.file.slice('generated:'.length))
        const result = await savePublicBank(bank.name, directory, bank.content, bank.images, false)
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
