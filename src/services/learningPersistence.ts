import { APP_VERSION_FALLBACK } from '../config/appInfo'
import { parseQuizNotebookData } from '../utils/quizData'
import { validateSessionData } from '../utils/sessionData'

export const DATA_SCHEMA_VERSION = 2
export const DATA_VERSION_KEY = 'exam-data-version'
export const DATA_RESTORE_LOCK = 'exam-restore-pending'
const PREFIXES = ['practice_session_', 'wrong_session_', 'specialize_session_', 'exam_session_', 'endorse_session_', 'practice_shuffle_pref_']
const KEYS = ['wrongNotebookData_v2', 'lastBank', 'darkMode', 'desktopQuizPresentation', 'autoCheckUpdates', 'plantUmlServerOverride', 'bankSources_v2']

export function isLearningKey(key: string): boolean {
  return KEYS.includes(key) || PREFIXES.some(prefix => key.startsWith(prefix))
}

export function storageKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(Boolean)
}

export function captureLearningValues(): Record<string, string> {
  return Object.fromEntries(storageKeys().filter(isLearningKey).map(key => [key, localStorage.getItem(key)!]))
}

export function dataEnvelope(values = captureLearningValues()) {
  return { schemaVersion: DATA_SCHEMA_VERSION, appVersion: APP_VERSION_FALLBACK, savedAt: Date.now(), values }
}

export function validateLearningValues(values: Record<string, string>) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('学习数据必须是键值对象')
  for (const [key, value] of Object.entries(values)) {
    if (!isLearningKey(key) || typeof value !== 'string') throw new Error(`学习数据字段不合法：${key}`)
    if (key === 'wrongNotebookData_v2') parseQuizNotebookData(value)
    if (key === 'bankSources_v2') {
      const sources = JSON.parse(value)
      if (!sources || typeof sources !== 'object' || Array.isArray(sources) || Object.values(sources).some(source => !['import', 'ai', 'legacy'].includes(String(source)))) throw new Error('题库来源标记损坏')
    }
    if (/^(practice|wrong|specialize|exam|endorse)_session_/.test(key)) validateSessionData(JSON.parse(value), key)
  }
}

let queue: Promise<void> = Promise.resolve()
let nativeBlocked = false
let lastValues = ''
let lastWriteError: unknown = null
export let persistenceError = ''
export function isNativeRuntime() { return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window }
export async function drainLearningWrites({ requireSaved = false }: { requireSaved?: boolean } = {}) {
  await queue
  // Backup/recovery can inspect protected records; an updater must not exit.
  if (!requireSaved) return
  if (nativeBlocked || localStorage.getItem(DATA_RESTORE_LOCK)) throw new Error('学习数据处于保护或恢复状态，禁止开始更新安装')
  if (lastWriteError) throw lastWriteError
}

/** Browser commits are synchronous; native snapshots are serialized and atomically replaced. */
export function persistLearningState(): Promise<void> {
  try {
    if (nativeBlocked || localStorage.getItem(DATA_RESTORE_LOCK)) return queue
    const envelope = dataEnvelope()
    validateLearningValues(envelope.values)
    const encodedValues = JSON.stringify(envelope.values)
    if (encodedValues === lastValues) return queue
    localStorage.setItem(DATA_VERSION_KEY, JSON.stringify({ ...envelope, values: undefined }))
    if (!isNativeRuntime()) { lastValues = encodedValues; return queue }
    const content = JSON.stringify(envelope)
    const write = queue.then(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_app_document', { name: 'learning-state.json', content })
      lastValues = encodedValues
      lastWriteError = null
    })
    queue = write.catch(error => {
      lastWriteError = error
      persistenceError = `学习进度文件保存失败，浏览器副本仍保留：${String(error)}`
      window.dispatchEvent(new CustomEvent('learning-save-error', { detail: persistenceError }))
    })
    return write
  } catch (error) {
    persistenceError = `学习进度保存失败，请检查存储空间并导出备份：${String(error)}`
    window.dispatchEvent(new CustomEvent('learning-save-error', { detail: persistenceError }))
    return Promise.reject(error)
  }
}

export async function initializeLearningPersistence(): Promise<void> {
  let localVersion: { schemaVersion?: number } = {}
  try {
    localVersion = JSON.parse(localStorage.getItem(DATA_VERSION_KEY) || '{}')
    if (!localVersion || typeof localVersion !== 'object' || Array.isArray(localVersion)) throw new Error('数据版本记录格式错误')
  }
  catch { localVersion = {}; nativeBlocked = true; persistenceError = '数据版本记录损坏，已保护原记录；请备份后恢复有效的全量备份。' }
  if (localVersion.schemaVersion !== undefined && localVersion.schemaVersion > DATA_SCHEMA_VERSION) throw new Error('数据来自更高版本，请使用新版应用打开，禁止降级覆盖')
  if (isNativeRuntime()) {
    const keys = ['wrongNotebookData_v2', 'wrongNotebookData_v2.previous', 'wrongNotebookData_v2.damaged',
      'wrongQuestionsDB', 'wrongEntriesDB', 'wrongNotebooksDB', 'guessedRightDB', 'activeWrongNotebook', DATA_VERSION_KEY, 'lastBank']
    const originals = Object.fromEntries(keys.filter(key => localStorage.getItem(key) !== null).map(key => [key, localStorage.getItem(key)!]))
    const { invoke } = await import('@tauri-apps/api/core')
    // Failure must stop boot before the store mounts or any new empty state is saved.
    await invoke('prepare_learning_upgrade', { browserValues: JSON.stringify(originals) })
  }
  if (localStorage.getItem(DATA_RESTORE_LOCK)) {
    // Restore orchestration keeps a durable pre-restore snapshot in IndexedDB.
    const { recoverInterruptedRestore } = await import('./fullBackup')
    await recoverInterruptedRestore()
  }
  if (isNativeRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      const raw = await invoke<string | null>('read_app_document', { name: 'learning-state.json' })
      if (raw) {
        const state = JSON.parse(raw)
        if (state.schemaVersion !== DATA_SCHEMA_VERSION || !state.values || typeof state.savedAt !== 'number' || !Number.isFinite(state.savedAt) || state.savedAt < 0) throw new Error('不支持或损坏的数据版本')
        for (const [key, value] of Object.entries(state.values)) {
          if (!isLearningKey(key) || typeof value !== 'string') throw new Error('学习数据字段不合法')
        }
        validateLearningValues(state.values)
        const metadata = JSON.parse(localStorage.getItem(DATA_VERSION_KEY) || '{}')
        if (!metadata.savedAt || state.savedAt > metadata.savedAt) {
          const original = captureLearningValues()
          const incoming = { ...state.values }
          // The envelope timestamp includes preference/session writes. It does
          // not prove its embedded notebook is newer than a pending store save.
          const localNotebook = original.wrongNotebookData_v2
          const savedNotebook = incoming.wrongNotebookData_v2
          if (localNotebook && (!savedNotebook ||
            (parseQuizNotebookData(localNotebook).savedAt ?? 0) > (parseQuizNotebookData(savedNotebook).savedAt ?? 0))) {
            incoming.wrongNotebookData_v2 = localNotebook
          }
          try {
            for (const key of storageKeys().filter(isLearningKey)) localStorage.removeItem(key)
            for (const [key, value] of Object.entries(incoming)) localStorage.setItem(key, value as string)
          } catch (error) {
            for (const key of storageKeys().filter(isLearningKey)) localStorage.removeItem(key)
            for (const [key, value] of Object.entries(original)) localStorage.setItem(key, value)
            throw error
          }
        }
      }
    } catch (error) {
      nativeBlocked = true
      persistenceError = `本地学习快照无法读取，已保护原文件：${String(error)}`
    }
  }
  // v0.1.5/v0.1.6 use the same keys. This migration adds metadata, not destructive renaming.
  // Native boot must hydrate quiz-data.json before writing a learning envelope.
  if (!nativeBlocked && !isNativeRuntime()) await persistLearningState().catch(() => { /* Mount recovery UI without overwriting damaged records. */ })
}
