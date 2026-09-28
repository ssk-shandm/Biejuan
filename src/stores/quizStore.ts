import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Question, WrongQuestionEntry, WrongNotebook } from '../types'
import { showToast } from '../composables/useToast'
import { normalizeQuestionBank } from '../utils/questionSchema'
import { saveExportBlob } from '../services/fileService'

const WRONG_ENTRIES_KEY = 'wrongEntriesDB'
const NOTEBOOKS_KEY = 'wrongNotebooksDB'
const ACTIVE_NOTEBOOK_KEY = 'activeWrongNotebook'
const GUESSED_KEY = 'guessedRightDB'

// ── 合并持久化（单文件，像 public/subjects/ 一样） ──
const COMBINED_FILE = 'quiz-data.json'
const COMBINED_LOCAL_KEY = 'wrongNotebookData_v2'

// ── Tauri 文件持久化（比 localStorage 更可靠） ──
let tauriDataDir: string | null = null
let tauriWriteAvailable = false

async function initTauriStorage() {
  try {
    // 检查是否在 Tauri 环境中
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
    const { appDataDir } = await import('@tauri-apps/api/path')
    const { exists, mkdir } = await import('@tauri-apps/plugin-fs')
    tauriDataDir = await appDataDir()
    if (!(await exists(tauriDataDir))) {
      await mkdir(tauriDataDir, { recursive: true })
    }
    tauriWriteAvailable = true
  } catch (e) {
    console.warn('[quizStore] Tauri 存储初始化失败，使用 localStorage 作为后备:', e)
  }
}

async function readTauriFile(filename: string): Promise<string | null> {
  if (!tauriDataDir || !tauriWriteAvailable) return null
  try {
    const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const path = await join(tauriDataDir, filename)
    if (!(await exists(path))) return null
    return await readTextFile(path)
  } catch {
    return null
  }
}

async function writeTauriFile(filename: string, content: string): Promise<void> {
  if (!tauriDataDir || !tauriWriteAvailable) return
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const { join } = await import('@tauri-apps/api/path')
    const path = await join(tauriDataDir, filename)
    await writeTextFile(path, content)
  } catch (e) {
    console.warn('[quizStore] Tauri 写入失败:', e)
  }
}

const tauriStorageReady = initTauriStorage()

// ── 从旧版 localStorage 迁移 ──
function migrateOldStorage() {
  // 清理旧版 wrong_session_* 数据
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('wrong_session_')) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k))

  // 迁移旧版 wrongQuestionsDB (number[]) → wrongEntriesDB (WrongQuestionEntry[])
  const oldWrongKey = 'wrongQuestionsDB'
  const oldData = localStorage.getItem(oldWrongKey)
  if (oldData) {
    try {
      const oldNumbers: number[] = JSON.parse(oldData)
      if (Array.isArray(oldNumbers) && oldNumbers.length > 0) {
        const entries: WrongQuestionEntry[] = oldNumbers.map((num, i) => ({
          id: Date.now() + i,
          questionNumber: num,
          bankFile: '',
          addedAt: Date.now() + i,
        }))
        const existing: WrongQuestionEntry[] = JSON.parse(localStorage.getItem(WRONG_ENTRIES_KEY) || '[]')
        localStorage.setItem(WRONG_ENTRIES_KEY, JSON.stringify([...existing, ...entries]))
      }
    } catch { /* 忽略 */ }
    localStorage.removeItem(oldWrongKey)
  }

  // 旧版 guessedRightDB 是 number[]，新版是 {questionNumber, bankFile}[]
  const oldGuessed = localStorage.getItem(GUESSED_KEY)
  if (oldGuessed) {
    try {
      const parsed = JSON.parse(oldGuessed)
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
        const migrated = parsed.map((num: number) => ({ questionNumber: num, bankFile: '' }))
        localStorage.setItem(GUESSED_KEY, JSON.stringify(migrated))
      }
    } catch { /* 忽略 */ }
  }

  // ── 迁移旧版 flat wrongEntriesDB → 笔记本结构 ──
  // 如果已有 notebook 数据则跳过
  if (!localStorage.getItem(NOTEBOOKS_KEY)) {
    const raw = localStorage.getItem(WRONG_ENTRIES_KEY)
    if (raw) {
      try {
        const entries: WrongQuestionEntry[] = JSON.parse(raw)
        if (Array.isArray(entries) && entries.length > 0) {
          // 按 bankFile 分组
          const groups = new Map<string, WrongQuestionEntry[]>()
          for (const e of entries) {
            const bf = e.bankFile || '(未知题库)'
            if (!groups.has(bf)) groups.set(bf, [])
            groups.get(bf)!.push(e)
          }
          // 每组创建一个默认笔记本
          const notebooks: WrongNotebook[] = []
          const allEntries: WrongQuestionEntry[] = []
          for (const [bf, groupEntries] of groups) {
            const nbId = 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
            notebooks.push({
              id: nbId,
              name: bf + ' 错题本',
              bankFile: bf,
              createdAt: Date.now(),
            })
            for (const e of groupEntries) {
              e.notebookId = nbId
              allEntries.push(e)
            }
          }
          localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(notebooks))
          localStorage.setItem(WRONG_ENTRIES_KEY, JSON.stringify(allEntries))
        }
      } catch { /* 忽略 */ }
    }
  }
}

try {
  migrateOldStorage()
} catch (err) {
  console.warn('本地数据迁移失败，原有数据已保留:', err)
  // 不再清空数据 — 保留用户已有的错题数据
}


let nextId = Date.now()

function genNotebookId(): string {
  return 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

export const useQuizStore = defineStore('quiz', () => {
  // ── 加载初始数据：浏览器使用 localStorage，桌面端随后用 appData 单文件覆盖 ──
  let initialNotebooks: WrongNotebook[] = []
  let initialEntries: WrongQuestionEntry[] = []
  let initialActive: Record<string, string> = {}
  let initialGuessed: { questionNumber: number; bankFile: string }[] = []

  // 浏览器只读取一个合并文档；没有时再兼容旧版分散键。
  try {
    const combined = JSON.parse(localStorage.getItem(COMBINED_LOCAL_KEY) || 'null')
    if (combined && Array.isArray(combined.notebooks) && Array.isArray(combined.wrongEntries)) {
      initialNotebooks = combined.notebooks
      initialEntries = combined.wrongEntries
      initialActive = combined.activeNotebookByBank || {}
      initialGuessed = combined.guessedRight || []
    } else {
      initialNotebooks = JSON.parse(localStorage.getItem(NOTEBOOKS_KEY) || '[]')
      initialEntries = JSON.parse(localStorage.getItem(WRONG_ENTRIES_KEY) || '[]')
      initialActive = JSON.parse(localStorage.getItem(ACTIVE_NOTEBOOK_KEY) || '{}')
      initialGuessed = JSON.parse(localStorage.getItem(GUESSED_KEY) || '[]')
    }
  } catch {
    initialNotebooks = []
    initialEntries = []
    initialActive = {}
    initialGuessed = []
  }

  // 以上述为后备值创建 ref
  const notebooks = ref<WrongNotebook[]>(initialNotebooks)
  const wrongEntries = ref<WrongQuestionEntry[]>(initialEntries)
  const activeNotebookByBank = ref<Record<string, string>>(initialActive)
  const guessedRightBank = ref<{ questionNumber: number; bankFile: string }[]>(initialGuessed)

  // ── 桌面端异步加载单文件数据；浏览器已同步读取 localStorage ──
  async function loadPersistedData() {
    await tauriStorageReady
    // 桌面版优先从 appDataDir 的单文件读取。
    const tauriRaw = await readTauriFile(COMBINED_FILE)
    if (tauriRaw) {
      try {
        const data = JSON.parse(tauriRaw)
        if (data && Array.isArray(data.notebooks) && Array.isArray(data.wrongEntries)) {
          notebooks.value = data.notebooks
          wrongEntries.value = data.wrongEntries
          activeNotebookByBank.value = data.activeNotebookByBank || {}
          guessedRightBank.value = data.guessedRight || []
          const maxId = data.wrongEntries.reduce((m: number, e: { id: number }) => Math.max(m, e.id), 0)
          nextId = Math.max(nextId, maxId + 1)
          console.log('[quizStore] 已从 Tauri 文件加载错题本数据')
          return
        }
      } catch (e) { console.warn('[quizStore] Tauri 数据解析失败:', e) }
    }

  }
  const persistedDataReady = loadPersistedData()

  // ── 合并持久化：浏览器 localStorage + 桌面 appData 单文件 ──
  function saveCombinedData() {
    const data = {
      version: 1,
      savedAt: Date.now(),
      notebooks: notebooks.value,
      wrongEntries: wrongEntries.value,
      activeNotebookByBank: activeNotebookByBank.value,
      guessedRight: guessedRightBank.value,
    }
    const json = JSON.stringify(data)
    localStorage.setItem(COMBINED_LOCAL_KEY, json)
    return tauriStorageReady.then(() => writeTauriFile(COMBINED_FILE, json))
  }

  // 所有数据变化共享一个防抖 watch
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveCombinedData(); saveTimer = null }, 200)
  }

  watch([notebooks, wrongEntries, activeNotebookByBank, guessedRightBank],
    () => { scheduleSave() },
    { deep: true },
  )

  // ── 笔记本操作 ──

  /** 创建新笔记本 */
  function createNotebook(name: string, bankFile: string): WrongNotebook {
    const nb: WrongNotebook = {
      id: genNotebookId(),
      name,
      bankFile,
      createdAt: Date.now(),
    }
    notebooks.value.push(nb)
    activeNotebookByBank.value[bankFile] = nb.id
    return nb
  }

  /** 删除笔记本及其所有条目 */
  function deleteNotebook(notebookId: string) {
    notebooks.value = notebooks.value.filter((n) => n.id !== notebookId)
    wrongEntries.value = wrongEntries.value.filter((e) => e.notebookId !== notebookId)
    // 清理活跃引用
    for (const bf in activeNotebookByBank.value) {
      if (activeNotebookByBank.value[bf] === notebookId) {
        delete activeNotebookByBank.value[bf]
      }
    }
  }

  /** Remove every notebook, wrong answer and guessed-right entry for deleted banks. */
  async function removeBanksData(bankFiles: string[]) {
    await persistedDataReady
    const removed = new Set(bankFiles)
    const notebookIds = new Set(notebooks.value.filter(n => removed.has(n.bankFile)).map(n => n.id))
    notebooks.value = notebooks.value.filter(n => !removed.has(n.bankFile))
    wrongEntries.value = wrongEntries.value.filter(e => !removed.has(e.bankFile) && !(e.notebookId && notebookIds.has(e.notebookId)))
    guessedRightBank.value = guessedRightBank.value.filter(e => !removed.has(e.bankFile))
    for (const file of bankFiles) delete activeNotebookByBank.value[file]
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    await saveCombinedData()
  }
  /** 重命名笔记本 */
  function renameNotebook(notebookId: string, newName: string) {
    const nb = notebooks.value.find((n) => n.id === notebookId)
    if (nb) nb.name = newName
  }

  /** 获取指定题库的所有笔记本 */
  function getNotebooksByBank(bankFile: string): WrongNotebook[] {
    return notebooks.value.filter((n) => n.bankFile === bankFile).sort((a, b) => a.createdAt - b.createdAt)
  }

  /** 获取所有笔记本 */
  function getAllNotebooks(): WrongNotebook[] {
    return [...notebooks.value]
  }

  /** 获取或创建默认笔记本
   *  仅返回当前活跃的笔记本；若该题库无活跃笔记本则新建一个。
   *  这样每次「重置后再做」都会得到一个新错题本，避免追加到旧本。
   *  新建时自动加序号 (2)、(3)... 防止同名混淆。
   */
  function getOrCreateDefaultNotebook(bankFile: string): WrongNotebook {
    const activeId = activeNotebookByBank.value[bankFile]
    if (activeId) {
      const active = notebooks.value.find((n) => n.id === activeId && n.bankFile === bankFile)
      if (active) return active
    }
    const baseName = bankFile + ' 错题本'
    const existing = notebooks.value.filter((n) => n.bankFile === bankFile)
    const name = existing.length > 0 ? `${baseName} (${existing.length + 1})` : baseName
    return createNotebook(name, bankFile)
  }

  /** 设置活跃笔记本 */
  function setActiveNotebook(bankFile: string, notebookId: string) {
    activeNotebookByBank.value[bankFile] = notebookId
  }

  /** 清除指定题库的活跃笔记本标记（重置做题进度时调用）。
   *  下次「添加到错题本」时会新建一个笔记本，而不是追加到旧本。
   */
  function clearActiveNotebook(bankFile: string) {
    delete activeNotebookByBank.value[bankFile]
  }

  /** 获取当前活跃的笔记本 */
  function getActiveNotebook(bankFile: string): WrongNotebook | undefined {
    const id = activeNotebookByBank.value[bankFile]
    if (id) return notebooks.value.find((n) => n.id === id)
    // fallback: 返回第一个匹配的笔记本
    return notebooks.value.find((n) => n.bankFile === bankFile)
  }

  // ── 条目操作（基于笔记本） ──

  /** 添加一条错题记录到指定笔记本（不自动创建/查找笔记本） */
  function addWrongEntryToNotebook(questionNumber: number, bankFile: string, notebookId: string) {
    wrongEntries.value.push({
      id: nextId++,
      questionNumber,
      bankFile,
      addedAt: Date.now(),
      notebookId,
    })
  }

  /** 添加一条错题记录（写入活跃笔记本） */
  function addWrongEntry(questionNumber: number, bankFile: string) {
    const nb = getOrCreateDefaultNotebook(bankFile)
    wrongEntries.value.push({
      id: nextId++,
      questionNumber,
      bankFile,
      addedAt: Date.now(),
      notebookId: nb.id,
    })
  }

  /** 按 entry id 移除单条错题记录 */
  function removeWrongEntry(id: number) {
    wrongEntries.value = wrongEntries.value.filter((e) => e.id !== id)
  }

  /** 获取指定笔记本的所有错题条目（按添加时间正序） */
  function getEntriesByNotebook(notebookId: string): WrongQuestionEntry[] {
    return wrongEntries.value
      .filter((e) => e.notebookId === notebookId)
      .sort((a, b) => a.addedAt - b.addedAt)
  }

  /** 获取指定题库活跃笔记本的条目（兼容旧接口） */
  function getWrongEntriesByBank(bankFile: string): WrongQuestionEntry[] {
    const nb = getActiveNotebook(bankFile)
    if (!nb) return []
    return getEntriesByNotebook(nb.id)
  }

  /** 判断指定题库的活跃错题本中是否已包含某题号。
   *  仅检查当前活跃错题本（无活跃标记则返回 false，不走 fallback），
   *  与「添加到错题本」按钮的按本去重语义一致：
   *  重置做题进度后活跃标记被清除，此函数返回 false，单题按钮恢复为「添加到错题」可点状态，
   *  从而允许把已添加到旧错题本的题重新加入新建的错题本。
   */
  function containsWrongEntry(questionNumber: number, bankFile: string): boolean {
    const activeId = activeNotebookByBank.value[bankFile]
    if (!activeId) return false
    return wrongEntries.value.some(
      (e) => e.questionNumber === questionNumber && e.notebookId === activeId,
    )
  }

  /** 清空指定笔记本的所有错题 */
  function clearEntriesByNotebook(notebookId: string) {
    wrongEntries.value = wrongEntries.value.filter((e) => e.notebookId !== notebookId)
  }

  /** 清空指定题库活跃笔记本的错题（兼容旧接口） */
  function clearWrongEntriesByBank(bankFile: string) {
    const nb = getActiveNotebook(bankFile)
    if (nb) clearEntriesByNotebook(nb.id)
  }

  /** 清空所有错题 */
  function clearAllWrongEntries() {
    wrongEntries.value = []
    notebooks.value = []
    activeNotebookByBank.value = {}
  }

  /** 获取指定题库的去重题号集合 */
  function getUniqueWrongNumbers(bankFile: string): number[] {
    return [...new Set(wrongEntries.value.filter((e) => e.bankFile === bankFile).map((e) => e.questionNumber))]
  }

  // ── 蒙对标记 ──

  function addGuessedRight(questionNumber: number, bankFile: string) {
    if (!guessedRightBank.value.some((g) => g.questionNumber === questionNumber && g.bankFile === bankFile)) {
      guessedRightBank.value.push({ questionNumber, bankFile })
    }
  }

  function removeGuessedRight(questionNumber: number, bankFile: string) {
    guessedRightBank.value = guessedRightBank.value.filter(
      (g) => !(g.questionNumber === questionNumber && g.bankFile === bankFile),
    )
  }

  function isGuessedRight(questionNumber: number, bankFile: string): boolean {
    return guessedRightBank.value.some(
      (g) => g.questionNumber === questionNumber && g.bankFile === bankFile,
    )
  }

  function clearGuessedRightByBank(bankFile: string) {
    guessedRightBank.value = guessedRightBank.value.filter((g) => g.bankFile !== bankFile)
  }

  /** 所有属于错题的题号（去重，不区分题库） */
  function allWrongNumbers(): number[] {
    return [...new Set(wrongEntries.value.map((e) => e.questionNumber))]
  }

  // ── 导入导出 ──

  /** 导出指定笔记本的错题为 JSON 文件 */
  async function exportNotebook(notebookId: string, allQuestions: Question[]) {
    const entries = getEntriesByNotebook(notebookId)
    if (entries.length === 0) {
      showToast('该错题本是空的！')
      return
    }

    const nums = [...new Set(entries.map((e) => e.questionNumber))]
    const wrongQuestions = allQuestions.filter((q) => nums.includes(q.number))

    const nb = notebooks.value.find((n) => n.id === notebookId)
    const fileName = nb ? nb.name.replace(/[/\\?%*:|"<>]/g, '_') + '.json' : 'wrong_questions_backup.json'
    try {
      const saved = await saveExportBlob(fileName, new Blob([JSON.stringify(wrongQuestions, null, 2)], { type: 'application/json' }))
      if (saved) showToast(`成功导出 ${wrongQuestions.length} 道错题！`)
    } catch (error) {
      console.error('Notebook export failed:', error)
      showToast('导出错题本失败，请重试')
    }
  }

  /** 导出当前活跃笔记本（兼容旧接口） */
  function exportWrongQuestions(allQuestions: Question[], bankFile: string) {
    const nb = getActiveNotebook(bankFile)
    if (!nb) { showToast('当前题库没有错题本！'); return }
    exportNotebook(nb.id, allQuestions)
  }

  /** 导入错题到新笔记本 */
  function importToNewNotebook(name: string, bankFile: string, questions: Question[]) {
    const nb = createNotebook(name, bankFile)
    for (const q of questions) {
      wrongEntries.value.push({
        id: nextId++,
        questionNumber: q.number,
        bankFile,
        addedAt: Date.now(),
        notebookId: nb.id,
      })
    }
    return nb
  }

  /** 导入错题到已有笔记本 */
  function importToNotebook(notebookId: string, bankFile: string, questions: Question[]) {
    for (const q of questions) {
      wrongEntries.value.push({
        id: nextId++,
        questionNumber: q.number,
        bankFile,
        addedAt: Date.now(),
        notebookId,
      })
    }
  }

  /** 导入错题（兼容旧接口） — 导入到当前活跃笔记本 */
  function importWrongQuestions(file: File, bankFile: string) {
    if (!file || file.type !== 'application/json') {
      showToast('请选择一个有效的 JSON 文件')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const importedQuestions = normalizeQuestionBank(JSON.parse(content), file.name)

        if (
          !Array.isArray(importedQuestions) ||
          importedQuestions.some((q) => typeof q.number !== 'number')
        ) {
          throw new Error('JSON 格式无效')
        }

        const nb = getOrCreateDefaultNotebook(bankFile)
        let count = 0
        for (const q of importedQuestions) {
          wrongEntries.value.push({
            id: nextId++,
            questionNumber: q.number,
            bankFile,
            addedAt: Date.now(),
            notebookId: nb.id,
          })
          count++
        }
        showToast(`成功导入 ${count} 道错题到「${nb.name}」！`)
      } catch (error) {
        console.error('导入失败:', error)
        showToast('导入失败，文件格式可能不正确。')
      }
    }
    reader.readAsText(file)
  }

  // ── 全部数据备份与恢复（JSON 文件永久化） ──

  /** 获取备份数据中包含的总错题数量 */
  function getBackupEntryCount(): number {
    return wrongEntries.value.length
  }

  /** 将全部错题本数据导出为 JSON 字符串，供下载备份 */
  function exportAllDataAsJson(): string {
    const backup = {
      version: 1,
      exportedAt: Date.now(),
      notebooks: notebooks.value,
      wrongEntries: wrongEntries.value,
      activeNotebookByBank: activeNotebookByBank.value,
      guessedRight: guessedRightBank.value,
    }
    return JSON.stringify(backup, null, 2)
  }

  /** 从 JSON 字符串恢复全部错题本数据（会覆盖当前数据） */
  function importAllDataFromJson(jsonStr: string): { success: boolean; message: string } {
    try {
      const data = JSON.parse(jsonStr)
      if (!data || typeof data !== 'object') {
        return { success: false, message: '无效的备份文件格式' }
      }
      if (data.version !== 1) {
        return { success: false, message: '不支持的备份版本，请检查文件' }
      }
      if (!Array.isArray(data.notebooks)) {
        return { success: false, message: '备份文件中缺少 notebooks 数据' }
      }
      if (!Array.isArray(data.wrongEntries)) {
        return { success: false, message: '备份文件中缺少 wrongEntries 数据' }
      }

      notebooks.value = data.notebooks
      wrongEntries.value = data.wrongEntries
      activeNotebookByBank.value = data.activeNotebookByBank || {}
      guessedRightBank.value = data.guessedRight || []

      // 更新 nextId 避免与恢复的条目 ID 冲突
      const maxId = data.wrongEntries.reduce((m: number, e: { id: number }) => Math.max(m, e.id), 0)
      nextId = Math.max(nextId, maxId + 1)

      const nbCount = data.notebooks.length
      const entryCount = data.wrongEntries.length
      return { success: true, message: `成功恢复 ${nbCount} 个错题本，共 ${entryCount} 条错题记录！` }
    } catch (e) {
      return { success: false, message: `解析备份文件失败: ${e instanceof Error ? e.message : '未知错误'}` }
    }
  }

  return {
    notebooks,
    wrongEntries,
    activeNotebookByBank,
    createNotebook,
    deleteNotebook,
    removeBanksData,
    renameNotebook,
    getNotebooksByBank,
    getAllNotebooks,
    getOrCreateDefaultNotebook,
    setActiveNotebook,
    clearActiveNotebook,
    getActiveNotebook,
    getEntriesByNotebook,
    clearEntriesByNotebook,
    addWrongEntry,
    addWrongEntryToNotebook,
    removeWrongEntry,
    getWrongEntriesByBank,
    containsWrongEntry,
    clearWrongEntriesByBank,
    clearAllWrongEntries,
    getUniqueWrongNumbers,
    allWrongNumbers,
    guessedRightBank,
    addGuessedRight,
    removeGuessedRight,
    isGuessedRight,
    clearGuessedRightByBank,
    exportWrongQuestions,
    exportNotebook,
    importWrongQuestions,
    importToNewNotebook,
    importToNotebook,
    // 备份与恢复
    exportAllDataAsJson,
    importAllDataFromJson,
    getBackupEntryCount,
  }
})
