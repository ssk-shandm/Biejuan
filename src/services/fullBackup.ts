import { invoke } from '@tauri-apps/api/core'
import { listGeneratedBanks, readStoredGeneratedBank, replaceGeneratedBanks, type SavedBank } from './generatedBankStorage'
import { listPublicBanks } from './publicBankStorage'
import { captureLearningValues, DATA_RESTORE_LOCK, DATA_SCHEMA_VERSION, DATA_VERSION_KEY, dataEnvelope, drainLearningWrites, isLearningKey, isNativeRuntime, storageKeys, validateLearningValues } from './learningPersistence'
import { normalizeQuestionBank } from '../utils/questionSchema'
import { parseQuizNotebookData } from '../utils/quizData'
import { isBankSessionKey } from '../utils/bankSessionKeys'

export interface BackupFile { path: string; data: string }
interface PackedBank { file: string; name: string; content: string; images: { fileName: string; data: string; mime: string }[] }
export interface BackupPayload {
  schemaVersion: 2
  appVersion: string
  createdAt: number
  platform: 'native' | 'browser'
  runtime: 'desktop' | 'android' | 'web'
  nativeFiles: BackupFile[]
  banks: PackedBank[]
  values: Record<string, string>
  rawSnapshot?: boolean
  rawDocuments?: BackupFile[]
}
export interface FullBackup { format: 'biejuan-full-backup'; sha256: string; payload: BackupPayload }
const MAX_SIZE = 256 * 1024 * 1024
function runtime() { return !isNativeRuntime() ? 'web' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop' }

async function digest(text: string) {
  if (!crypto.subtle) throw new Error('当前环境无法执行安全校验。Web 版请使用 HTTPS 或 localhost 打开后再备份/恢复。')
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('')
}
function encode(bytes: Uint8Array): string {
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(text)
}
function decode(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), character => character.charCodeAt(0))
}
function textFile(path: string, text: string): BackupFile { return { path, data: encode(new TextEncoder().encode(text)) } }
function readText(file: BackupFile): string { return new TextDecoder('utf-8', { fatal: true }).decode(decode(file.data)).replace(/^\uFEFF/, '') }
function safeRelative(path: string) {
  if (!path || path.length > 1024 || path.split('/').some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|\x00-\x1f]/.test(part) || /[. ]$/.test(part))) throw new Error(`不安全的备份路径：${path}`)
}
function validBank(content: string, name: string) {
  if (!normalizeQuestionBank(JSON.parse(content.replace(/^\uFEFF/, '')), name).length) throw new Error(`空题库：${name}`)
}

async function snapshotStore(mode: 'read' | 'write' | 'remove', key: string, value?: FullBackup): Promise<FullBackup | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('exam-data-snapshots', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', mode === 'read' ? 'readonly' : 'readwrite')
    const store = transaction.objectStore('snapshots')
    const request = mode === 'read' ? store.get(key) : mode === 'write' ? store.put(value, key) : store.delete(key)
    transaction.oncomplete = () => { db.close(); resolve(mode === 'read' ? request.result : undefined) }
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || new Error('快照保存失败')) }
  })
}

export async function createFullBackup(rawSnapshot = false): Promise<FullBackup> {
  await drainLearningWrites()
  const payload: BackupPayload = {
    schemaVersion: DATA_SCHEMA_VERSION, appVersion: '0.2.0', createdAt: Date.now(),
    platform: isNativeRuntime() ? 'native' : 'browser', nativeFiles: [], banks: [], values: captureLearningValues(),
    runtime: runtime(),
  }
  if (rawSnapshot) payload.rawSnapshot = true
  if (isNativeRuntime()) payload.nativeFiles = await invoke<BackupFile[]>('export_content_data')
  if (rawSnapshot && isNativeRuntime()) {
    payload.rawDocuments = []
    for (const name of ['quiz-data.json', 'learning-state.json']) {
      const raw = await invoke<string | null>('read_app_document', { name })
      if (raw !== null) payload.rawDocuments.push(textFile('documents/' + name, raw))
    }
  }
  for (const entry of await listGeneratedBanks()) {
    const bank = await readStoredGeneratedBank(entry.file)
    payload.banks.push({ ...bank, images: await Promise.all(bank.images.map(async image => ({ fileName: image.fileName, data: encode(new Uint8Array(await image.blob.arrayBuffer())), mime: image.blob.type }))) })
  }
  if (!isNativeRuntime() && !rawSnapshot) {
    // Static web content is read-only. Restore it as local banks with remapped learning references.
    for (const bank of await listPublicBanks()) {
      const response = await fetch(bank.file, { cache: 'no-store' })
      if (!response.ok) throw new Error(`题库读取失败：${bank.name}`)
      let content = JSON.stringify(JSON.parse((await response.text()).replace(/^\uFEFF/, '')))
      const directory = `backup-${encodeURIComponent(bank.file)}`
      const file = `generated:${encodeURIComponent(directory)}`
      if (payload.banks.some(bank => bank.file === file)) {
        payload.values = remapBankReferences(payload.values, bank.file, file)
        continue
      }
      const paths = [...new Set(content.match(/\/images\/[^\s"\\)\]<>]+/g) ?? [])]
      const images: PackedBank['images'] = []
      for (const [index, path] of paths.entries()) {
        const response = await fetch(path)
        if (!response.ok) throw new Error(`图片无法备份：${path}`)
        const blob = await response.blob()
        const fileName = `asset-${index}.${path.split('.').pop()?.split('?')[0] || 'bin'}`
        images.push({ fileName, data: encode(new Uint8Array(await blob.arrayBuffer())), mime: blob.type })
        content = content.split(path).join(`/images/${directory}/${fileName}`)
      }
      payload.banks.push({ file, name: bank.name, content, images })
      payload.values = remapBankReferences(payload.values, bank.file, file)
    }
  }
  const result: FullBackup = { format: 'biejuan-full-backup', sha256: await digest(JSON.stringify(payload)), payload }
  if (!rawSnapshot) await validateFullBackup(result)
  return result
}

export function remapBankReferences(values: Record<string, string>, from: string, to: string): Record<string, string> {
  const output: Record<string, string> = {}
  const notebookIds = values.wrongNotebookData_v2
    ? parseQuizNotebookData(values.wrongNotebookData_v2).notebooks.filter(notebook => notebook.bankFile === from).map(notebook => notebook.id) : []
  for (const [key, value] of Object.entries(values)) {
    let nextKey = key
    for (const prefix of ['practice_session_', 'wrong_session_', 'specialize_session_', 'exam_session_', 'endorse_session_', 'practice_shuffle_pref_']) {
      if ((key === prefix + from || key.startsWith(prefix + from + '_')) && isBankSessionKey(key, value, from, notebookIds)) nextKey = prefix + to + key.slice((prefix + from).length)
    }
    if (key === 'wrongNotebookData_v2') {
      const data = parseQuizNotebookData(value)
      for (const notebook of data.notebooks) if (notebook.bankFile === from) notebook.bankFile = to
      for (const entry of [...data.wrongEntries, ...data.guessedRight]) if (entry.bankFile === from) entry.bankFile = to
      if (Object.prototype.hasOwnProperty.call(data.activeNotebookByBank, from)) { data.activeNotebookByBank[to] = data.activeNotebookByBank[from]!; delete data.activeNotebookByBank[from] }
      output[nextKey] = JSON.stringify(data)
    } else if (key === 'bankSources_v2') {
      const sources = JSON.parse(value)
      if (Object.prototype.hasOwnProperty.call(sources, from)) { sources[to] = sources[from]; delete sources[from] }
      output[nextKey] = JSON.stringify(sources)
    } else output[nextKey] = key === 'lastBank' && value === from ? to : value
  }
  return output
}

export async function validateFullBackup(input: unknown): Promise<FullBackup> {
  const backup = input as FullBackup
  if (!backup || backup.format !== 'biejuan-full-backup' || !backup.payload || backup.payload.schemaVersion !== 2) throw new Error('不是受支持的 v0.2 全量备份。旧版错题本 JSON 请在错题本页面恢复。')
  const payload = backup.payload
  if (payload.rawSnapshot || payload.rawDocuments) throw new Error('这是保护原始损坏数据的排错快照，不是可直接恢复的全量备份。请保留原件并修复其中的问题后再导入。')
  if (new Blob([JSON.stringify(backup)]).size > MAX_SIZE) throw new Error('备份超过 256 MB 限制')
  if (await digest(JSON.stringify(payload)) !== backup.sha256) throw new Error('备份校验和不匹配，文件可能损坏，当前数据未改变')
  if (!['native', 'browser'].includes(payload.platform) || !['desktop', 'android', 'web'].includes(payload.runtime) || typeof payload.appVersion !== 'string' || !Number.isFinite(payload.createdAt) || !Array.isArray(payload.nativeFiles) || !Array.isArray(payload.banks) || !payload.values || Array.isArray(payload.values)) throw new Error('备份结构不完整')
  if (payload.nativeFiles.length > 20000 || payload.banks.length > 20000) throw new Error('备份条目过多')
  const paths = new Set<string>()
  for (const file of payload.nativeFiles) {
    safeRelative(file.path)
    if (!/^(user|development)\/(subjects|images)\//.test(file.path) || paths.has(file.path.toLowerCase()) || typeof file.data !== 'string') throw new Error('备份路径重复或不受支持')
    paths.add(file.path.toLowerCase())
    decode(file.data)
    if (/\/subjects\//.test(file.path)) {
      if (!file.path.toLowerCase().endsWith('.json') || file.path.endsWith('/banks.json')) throw new Error('备份中的题库文件名无效')
      validBank(readText(file), file.path)
    }
  }
  const files = new Set<string>()
  for (const bank of payload.banks) {
    if (typeof bank.file !== 'string' || !bank.file.startsWith('generated:') || files.has(bank.file) || typeof bank.name !== 'string' || !Array.isArray(bank.images)) throw new Error('应用内题库格式错误或 ID 重复')
    files.add(bank.file)
    decodeURIComponent(bank.file.slice('generated:'.length))
    validBank(bank.content, bank.name)
    const imageNames = new Set<string>()
    for (const image of bank.images) {
      safeRelative(image.fileName)
      if (imageNames.has(image.fileName) || typeof image.mime !== 'string') throw new Error('图片名称重复或类型错误')
      imageNames.add(image.fileName)
      decode(image.data)
    }
  }
  validateLearningValues(payload.values)
  return backup
}

function writeValues(values: Record<string, string>) {
  for (const key of storageKeys().filter(isLearningKey)) if (!(key in values)) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value)
  localStorage.setItem(DATA_VERSION_KEY, JSON.stringify({ ...dataEnvelope(), values: undefined }))
}
async function applyBackup(backup: FullBackup, removePaths: string[] = []) {
  const payload = backup.payload
  if ((payload.platform === 'native') !== isNativeRuntime() || payload.runtime !== runtime()) throw new Error('v0.2 仅支持相同运行环境恢复；Windows/Android/Web 跨端迁移将在后续版本提供')
  if (isNativeRuntime()) {
    const documents = [textFile('documents/learning-state.json', JSON.stringify(dataEnvelope(payload.values)))]
    const notebook = payload.values.wrongNotebookData_v2
    documents.push(textFile('documents/quiz-data.json', notebook || JSON.stringify({ version: 1, notebooks: [], wrongEntries: [], activeNotebookByBank: {}, guessedRight: [] })))
    await invoke('restore_content_data', { files: [...payload.nativeFiles, ...(payload.rawSnapshot ? payload.rawDocuments ?? [] : documents)], removePaths })
  }
  const banks: SavedBank[] = payload.banks.map(bank => ({ ...bank, images: bank.images.map(image => ({ fileName: image.fileName, blob: new Blob([decode(image.data)], { type: image.mime }) })) }))
  await replaceGeneratedBanks(banks)
  writeValues(payload.values)
}

let restoreInProgress = false
export async function restoreFullBackup(backup: FullBackup): Promise<void> {
  if (restoreInProgress) throw new Error('已有恢复任务正在执行，请勿重复操作')
  restoreInProgress = true
  try { await performRestore(backup) } finally { restoreInProgress = false }
}

async function performRestore(backup: FullBackup): Promise<void> {
  await validateFullBackup(backup)
  if ((backup.payload.platform === 'native') !== isNativeRuntime() || backup.payload.runtime !== runtime()) throw new Error('备份来自不同运行环境，v0.2 暂不支持跨端恢复')
  if (localStorage.getItem(DATA_RESTORE_LOCK)) throw new Error('上次恢复尚未结束，请重启应用完成数据保护')
  // Raw rollback snapshots also preserve corrupt originals, so valid backups can repair damaged data.
  const rollback = await createFullBackup(true)
  let previous: FullBackup
  try { previous = await createFullBackup() } catch { previous = rollback }
  await snapshotStore('write', 'before-restore', previous)
  await snapshotStore('write', 'rollback', rollback)
  // This marker survives refresh/crash; rollback occurs before the application mounts.
  const newPaths = backup.payload.nativeFiles.map(file => file.path).filter(path => !rollback.payload.nativeFiles.some(file => file.path === path))
  if (isNativeRuntime()) for (const name of ['documents/quiz-data.json', 'documents/learning-state.json']) {
    if (!rollback.payload.rawDocuments?.some(file => file.path === name)) newPaths.push(name)
  }
  localStorage.setItem(DATA_RESTORE_LOCK, JSON.stringify({ newPaths }))
  try {
    await applyBackup(backup)
    localStorage.removeItem(DATA_RESTORE_LOCK)
  } catch (error) {
    try { await recoverInterruptedRestore() } catch (rollback) { throw new Error(`恢复失败；回滚待完成，请重启并保留数据目录：${String(rollback)}`) }
    throw new Error(`恢复失败，已回滚到恢复前数据：${String(error)}`)
  }
}

export async function recoverInterruptedRestore(): Promise<void> {
  const marker = localStorage.getItem(DATA_RESTORE_LOCK)
  if (!marker) return
  const previous = await snapshotStore('read', 'rollback')
  if (!previous) throw new Error('缺少恢复前快照，请勿清理存储')
  if (previous.format !== 'biejuan-full-backup' || await digest(JSON.stringify(previous.payload)) !== previous.sha256) throw new Error('恢复前快照已损坏，请保留数据目录')
  await applyBackup(previous, JSON.parse(marker).newPaths || [])
  localStorage.removeItem(DATA_RESTORE_LOCK)
}
export async function readBeforeRestoreSnapshot() { return snapshotStore('read', 'before-restore') }
export function backupSummary(backup: FullBackup) {
  return {
    banks: backup.payload.banks.length + backup.payload.nativeFiles.filter(file => /\/subjects\/.*\.json$/i.test(file.path)).length,
    images: backup.payload.banks.reduce((count, bank) => count + bank.images.length, 0) + backup.payload.nativeFiles.filter(file => /\/images\//.test(file.path)).length,
    sessions: Object.keys(backup.payload.values).filter(key => /_session_/.test(key)).length,
    notebooks: backup.payload.values.wrongNotebookData_v2 ? parseQuizNotebookData(backup.payload.values.wrongNotebookData_v2).notebooks.length : 0,
  }
}
