import { ref, watch, nextTick, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import type { Question, WrongQuestionEntry, WrongNotebook } from '../types'
import { showToast } from '../composables/useToast'
import { normalizeQuestionBank } from '../utils/questionSchema'
import { saveExportBlob } from '../services/fileService'
import { parseQuizNotebookData, validateQuizNotebookData, type QuizNotebookData } from '../utils/quizData'

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
    showToast('本地文件存储不可用，当前使用浏览器存储。请及时备份错题本。')
  }
}

async function readTauriFile(filename: string): Promise<string | null> {
  if (!tauriDataDir || !tauriWriteAvailable) return null
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  const path = await join(tauriDataDir, filename)
  if (!(await exists(path))) return null
  return readTextFile(path)
}

async function writeTauriFile(filename: string, content: string): Promise<void> {
  if (!tauriDataDir || !tauriWriteAvailable) return
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  await writeTextFile(await join(tauriDataDir, filename), content)
}

const tauriStorageReady = initTauriStorage()

// ── 从旧版 localStorage 迁移 ──
function migrateOldStorage() {
  // 已有合并文档时不再触碰遗留键；迁移只提交一个 localStorage 文档。
  if (localStorage.getItem(COMBINED_LOCAL_KEY) !== null) return
  const oldWrongKey = 'wrongQuestionsDB'
  const oldData = localStorage.getItem(oldWrongKey)
  const rawEntries = localStorage.getItem(WRONG_ENTRIES_KEY)
  const rawNotebooks = localStorage.getItem(NOTEBOOKS_KEY)
  const rawGuessed = localStorage.getItem(GUESSED_KEY)
  const rawActive = localStorage.getItem(ACTIVE_NOTEBOOK_KEY)
  if ([oldData, rawEntries, rawNotebooks, rawGuessed, rawActive].every(raw => raw === null)) return

  const entries: WrongQuestionEntry[] = JSON.parse(rawEntries || '[]')
  if (!Array.isArray(entries)) throw new Error('旧版错题记录不是数组')
  if (oldData !== null) {
    const numbers: unknown = JSON.parse(oldData)
    if (!Array.isArray(numbers) || numbers.some(number => !Number.isSafeInteger(number) || number <= 0)) {
      throw new Error('旧版错题题号格式错误')
    }
    let id = entries.reduce((max, entry) => Math.max(max, entry.id), Date.now()) + 1
    for (const questionNumber of numbers) {
      entries.push({ id: id++, questionNumber, bankFile: '', addedAt: Date.now() })
    }
  }

  const notebooks: WrongNotebook[] = JSON.parse(rawNotebooks || '[]')
  if (!Array.isArray(notebooks)) throw new Error('旧版错题本不是数组')
  // 给没有 notebookId 的历史条目补上默认本；保持真实 bankFile，未知来源仅用于显示名称。
  for (const entry of entries) {
    if (entry.notebookId) continue
    let notebook = notebooks.find(item => item.bankFile === entry.bankFile)
    if (!notebook) {
      notebook = {
        id: 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: (entry.bankFile || '(未知题库)') + ' 错题本',
        bankFile: entry.bankFile,
        createdAt: Date.now(),
      }
      notebooks.push(notebook)
    }
    entry.notebookId = notebook.id
  }

  const guessed: unknown = JSON.parse(rawGuessed || '[]')
  const data = validateQuizNotebookData({
    version: 1,
    notebooks,
    wrongEntries: entries,
    activeNotebookByBank: JSON.parse(rawActive || '{}'),
    guessedRight: Array.isArray(guessed)
      ? guessed.map(item => typeof item === 'number' ? { questionNumber: item, bankFile: '' } : item)
      : guessed,
  })
  localStorage.setItem(COMBINED_LOCAL_KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
  // 必须在目标校验、写入均成功之后移除旧题号；其他遗留键保留供排错。
  if (oldData !== null) localStorage.removeItem(oldWrongKey)
}

let legacyMigrationFailed = false
try {
  migrateOldStorage()
} catch (err) {
  legacyMigrationFailed = true
  console.warn('本地数据迁移失败，原有数据已保留:', err)
  showToast('旧版错题迁移失败，原始数据已保留。请先备份原始数据后重试。')
}


let nextId = Date.now()

function genNotebookId(): string {
  return 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

export const useQuizStore = defineStore('quiz', () => {
  let initial: QuizNotebookData = {
    version: 1, notebooks: [], wrongEntries: [], activeNotebookByBank: {}, guessedRight: [],
  }
  let browserWritesBlocked = legacyMigrationFailed
  let nativeWritesBlocked = false
  let hydrating = true
  let dirty = false

  try {
    const combined = localStorage.getItem(COMBINED_LOCAL_KEY)
    if (combined !== null) initial = parseQuizNotebookData(combined)
  } catch (error) {
    browserWritesBlocked = true
    console.warn('[quizStore] 浏览器错题数据读取失败，保留原文:', error)
    showToast('浏览器错题数据损坏或无法读取，原始数据未覆盖。请先备份原始数据，再恢复有效的错题本备份。')
  }

  // 浏览器原件不可读且原生文件缺失时，也不能生成空的原生文件掩盖损坏数据。
  nativeWritesBlocked = browserWritesBlocked

  const notebooks = ref<WrongNotebook[]>(initial.notebooks)
  const wrongEntries = ref<WrongQuestionEntry[]>(initial.wrongEntries)
  const activeNotebookByBank = ref<Record<string, string>>(initial.activeNotebookByBank)
  const guessedRightBank = ref<QuizNotebookData['guessedRight']>(initial.guessedRight)

  let lastSavedAt = initial.savedAt ?? 0
  function applyData(data: QuizNotebookData) {
    lastSavedAt = Math.max(lastSavedAt, data.savedAt ?? 0)
    notebooks.value = data.notebooks
    wrongEntries.value = data.wrongEntries
    activeNotebookByBank.value = data.activeNotebookByBank
    guessedRightBank.value = data.guessedRight
    const maxId = data.wrongEntries.reduce((max, entry) => Math.max(max, entry.id), 0)
    nextId = Math.max(nextId, maxId + 1)
  }
  applyData(initial)

  function serializeData() {
    lastSavedAt = Math.max(Date.now(), lastSavedAt + 1)
    return JSON.stringify({
      version: 1,
      savedAt: lastSavedAt,
      notebooks: notebooks.value,
      wrongEntries: wrongEntries.value,
      activeNotebookByBank: activeNotebookByBank.value,
      guessedRight: guessedRightBank.value,
    })
  }

  function cacheBrowserData(json: string) {
    if (browserWritesBlocked) return
    try {
      localStorage.setItem(COMBINED_LOCAL_KEY, json)
    } catch (error) {
      console.warn('[quizStore] 浏览器写入失败:', error)
      showToast('错题本保存失败：浏览器存储不可用或空间不足。请及时导出备份并重试。')
    }
  }

  async function loadPersistedData() {
    await tauriStorageReady
    let recoverBrowserCopy = false
    try {
      const raw = await readTauriFile(COMBINED_FILE)
      if (raw !== null) {
        const native = parseQuizNotebookData(raw)
        nativeWritesBlocked = false
        // 上次退出时原生写入可能没完成；仅在两端均有时间戳时采用更新的浏览器副本。
        if (initial.savedAt !== undefined && native.savedAt !== undefined && initial.savedAt > native.savedAt) {
          recoverBrowserCopy = true
        } else {
          applyData(native)
          browserWritesBlocked = false
          cacheBrowserData(JSON.stringify(native))
        }
      } else if (!browserWritesBlocked && initial.savedAt !== undefined) {
        recoverBrowserCopy = true
      }
    } catch (error) {
      // 不能把损坏/无权限的文件当成「不存在」，否则下一次操作会覆盖原件。
      nativeWritesBlocked = true
      console.warn('[quizStore] 本地错题文件读取失败，禁止自动覆盖:', error)
      showToast('本地错题文件损坏或无法读取，原始文件未覆盖。当前使用浏览器副本，请先备份原始文件，再恢复有效的错题本备份。')
    } finally {
      await nextTick()
      hydrating = false
      if (recoverBrowserCopy) scheduleSave()
    }
  }
  const persistedDataReady = loadPersistedData()

  // 原生写入串行执行，失败后队列仍可接受后续重试，避免旧快照晚完成覆盖新数据。
  let writeQueue: Promise<void> = Promise.resolve()
  function queueNativeWrite(json: string): Promise<void> {
    if (nativeWritesBlocked) return Promise.resolve()
    const write = writeQueue.then(() => writeTauriFile(COMBINED_FILE, json))
    writeQueue = write.catch(error => {
      console.warn('[quizStore] 本地文件写入失败:', error)
      showToast('错题本保存失败：本地文件写入失败。浏览器副本仍可用时可导出备份，请检查权限和磁盘空间后重试。')
    })
    return write
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function saveCombinedData(): Promise<void> {
    const json = serializeData()
    cacheBrowserData(json)
    dirty = false
    return queueNativeWrite(json)
  }
  function scheduleSave() {
    if (hydrating) return
    dirty = true
    // 浏览器副本不等待原生防抖定时器，刷新/关闭前尽早保存。
    cacheBrowserData(serializeData())
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveCombinedData().catch(() => { /* queueNativeWrite 已提示失败 */ })
    }, 200)
  }

  watch([notebooks, wrongEntries, activeNotebookByBank, guessedRightBank], scheduleSave, { deep: true })

  function flushPendingSave() {
    if (hydrating) return
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    // pagehide 可早于 Vue 的 watch 微任务，直接捕获最新的 ref 值。
    void saveCombinedData().catch(() => { /* queueNativeWrite 已提示失败 */ })
  }
  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') flushPendingSave()
  }
  window.addEventListener('pagehide', flushPendingSave)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  onScopeDispose(() => {
    window.removeEventListener('pagehide', flushPendingSave)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (dirty) flushPendingSave()
    if (saveTimer) clearTimeout(saveTimer)
  })

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
    if (hydrating) return { success: false, message: '正在加载本地错题本，请稍后再恢复' }
    try {
      const data = parseQuizNotebookData(jsonStr)
      // 先写浏览器副本；校验/配额失败都不改变当前内存数据。
      localStorage.setItem(COMBINED_LOCAL_KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
      browserWritesBlocked = false
      nativeWritesBlocked = false
      applyData(data)
      return { success: true, message: '成功恢复 ' + data.notebooks.length + ' 个错题本，共 ' + data.wrongEntries.length + ' 条错题记录！' }
    } catch (error) {
      return { success: false, message: '恢复错题本失败，当前数据未改变：' + (error instanceof Error ? error.message : '未知错误') }
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
    persistedDataReady,
    exportAllDataAsJson,
    importAllDataFromJson,
    getBackupEntryCount,
  }
})
