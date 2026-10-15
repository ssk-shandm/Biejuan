import { ref, shallowRef, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { Question, UserAnswer, AppMode, SubAnswer, SubQuestion } from '../types'
import { stripMarkdown } from '../utils/markdown'
import { persistLearningState } from '../services/learningPersistence'
import { bankIssueReport, inspectBank } from '../utils/bankImport'
import { normalizeQuestionBank } from '../utils/questionSchema'
import { useQuizStore } from '../stores/quizStore'
import { showToast, showConfirm } from './useToast'
import { isJsonFile, readImportedText } from '../services/fileService'
import { GENERATED_BANK_PREFIX, GENERATED_BANKS_CHANGED, listGeneratedBanks, readGeneratedBank } from '../services/generatedBankStorage'
import { listPublicBanks, readPublicBank } from '../services/publicBankStorage'
import { PUBLIC_BANKS_CHANGED, migrateGeneratedBanksToPublic, savePublicBank } from '../services/publicBankWriter'

export interface BankEntry {
  name: string
  file: string
  /** 是否为用户从外部导入的题库 */
  imported?: boolean
  /** 桌面端扫描结果：是否允许从当前存储目录删除 JSON 文件 */
  deletable?: boolean
}

export type AnswerSheetEntry = {
  userAnswer: UserAnswer
  isCorrect: boolean | null
  showResult?: boolean
  subAnswers?: Map<number, SubAnswer>
  subDrafts?: Record<number, string>
}

/** 所有题库（启动时从 banks.json 动态加载） */
export const banks = ref<BankEntry[]>([])

const QUESTION_TYPES: Question['type'][] = [
  '单选题',
  '多选题',
  '判断题',
  '填空题',
  '简答题',
  '程序分析题',
  '编程题',
  '综合题',
  '综合应用题',
]

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j]!, array[i]!]
  }
  return array
}


export function useQuiz() {
  const quizStore = useQuizStore()

  // ── 核心状态 ──
  const isLoading = ref(true)
  const isRefreshingBanks = ref(false)
  let refreshPromise: Promise<void> | null = null
  const questions = shallowRef<Question[]>([])
  const shuffledQuestions = shallowRef<Question[]>([])
  const currentQuestionIndex = ref(0)
  const score = ref(0)
  const appMode = ref<AppMode>('start')
  const answerSheet = ref(new Map<number, AnswerSheetEntry>())
  const renderError = ref('')

  const currentBankFile = ref('')
  // 记住上次选择的题库
  const LAST_BANK_KEY = 'lastBank'
  const availableQuestionTypes = ref<string[]>([])
  const specializeTypes = ref<string[]>([])
  const shuffleEnabled = ref(false)
  const wrongDisplayEntryIds = ref<number[]>([])

  // ── 导入的外部题库 ──
  const generatedBanks = ref<BankEntry[]>([])
  const allBanks = computed(() => [...banks.value, ...generatedBanks.value])
  /** 缓存已导入的题库内容，以便切换题库时重新加载 */
  const importedCache = new Map<string, Question[]>()

  // ── 计算属性 ──
  const practiceStateKey = computed(() => `practice_session_${currentBankFile.value}`)
  const wrongStateKey = computed(() => {
    const notebookId = quizStore.getActiveNotebook(currentBankFile.value)?.id
    return `wrong_session_${currentBankFile.value}${notebookId ? `_${notebookId}` : ''}`
  })
  const shufflePrefKey = computed(() => `practice_shuffle_pref_${currentBankFile.value}`)
  const totalQuestions = computed(() => shuffledQuestions.value.length)
  const wrongCount = computed(() => quizStore.wrongEntries.filter((e) => e.bankFile === currentBankFile.value).length)

  // ── helpers ──
  function getQuestionsByTypes(types: string[], source: Question[]): Question[] {
    const selected = new Set(types)
    return source.filter((question) => selected.has(question.type))
  }

  const QUIZ_MODES = ['practice', 'exam', 'endorse', 'wrong', 'specialize'] as const

  // ── 题库清单加载 ──
  async function loadBanks() {
    const warnings: string[] = []
    try {
      warnings.push(...await migrateGeneratedBanksToPublic())
    } catch (error) {
      console.error('迁移本地题库失败:', error)
    }
    let discoveredBanks: BankEntry[] | null = null
    try {
      discoveredBanks = await listPublicBanks()
    } catch (error) {
      warnings.push(`无法扫描题库目录：${error instanceof Error ? error.message : String(error)}`)
    }
    const validBanks: BankEntry[] = []
    const invalidBanks: string[] = []
    const freshCache = new Map<string, Question[]>()
    for (const bank of discoveredBanks ?? []) {
      try {
        freshCache.set(bank.file, await readPublicBank(bank.file, bank.name))
        validBanks.push(bank)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        invalidBanks.push(`${bank.file.split('/').pop()}：${reason}`)
      }
    }
    if (discoveredBanks !== null) {
      for (const file of importedCache.keys()) {
        if (!file.startsWith(GENERATED_BANK_PREFIX)) importedCache.delete(file)
      }
      for (const [file, questions] of freshCache) importedCache.set(file, questions)
      banks.value = validBanks
    }
    try {
      generatedBanks.value = await listGeneratedBanks()
    } catch (e) {
      console.error('load generated banks failed:', e)
      warnings.push('加载应用内题库失败，请重启应用后重试。')
    }
    const preferred = currentBankFile.value || localStorage.getItem(LAST_BANK_KEY)
    currentBankFile.value = allBanks.value.find((bank) => bank.file === preferred)?.file
      ?? allBanks.value[0]?.file ?? ''
    if (currentBankFile.value) localStorage.setItem(LAST_BANK_KEY, currentBankFile.value)
    else localStorage.removeItem(LAST_BANK_KEY)
    if (invalidBanks.length > 0) {
      const details = invalidBanks.slice(0, 4).join('\n')
      const suffix = invalidBanks.length > 4 ? `\n另有 ${invalidBanks.length - 4} 个文件未显示。` : ''
      warnings.push(`发现 ${invalidBanks.length} 个无效题库，已跳过：\n${details}${suffix}`)
    }
    return warnings
  }

  function refreshBanks(): Promise<void> {
    if (refreshPromise) return refreshPromise
    refreshPromise = performBankRefresh().finally(() => { refreshPromise = null })
    return refreshPromise
  }

  async function performBankRefresh() {
    isRefreshingBanks.value = true
    const previousBankFile = currentBankFile.value
    let warnings: string[] = []
    try {
      warnings = await loadBanks()
      if (currentBankFile.value) await loadQuestions(currentBankFile.value, false)
      else {
        questions.value = []
        availableQuestionTypes.value = []
      }
      if (!currentBankFile.value || previousBankFile !== currentBankFile.value) {
        shuffledQuestions.value = []
        answerSheet.value.clear()
        currentQuestionIndex.value = 0
      }
    } catch (error) {
      console.error('刷新题库失败:', error)
      warnings.push(`刷新题库失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      isRefreshingBanks.value = false
      isLoading.value = false
    }
    await nextTick()
    if (warnings.length > 0) void showToast(warnings.join('\n\n'))
  }

  // ── 题库加载 ──
  async function loadQuestions(fileName: string = currentBankFile.value, showLoading = true) {
    if (showLoading) isLoading.value = true
    try {
      // 优先从已导入的缓存中加载
      const cached = importedCache.get(fileName)
      if (cached) {
        questions.value = cached
      } else if (fileName.startsWith(GENERATED_BANK_PREFIX)) {
        questions.value = normalizeQuestionBank(await readGeneratedBank(fileName), fileName)
      } else {
        questions.value = await readPublicBank(fileName)
      }
      const types = new Set(questions.value.map((q) => q.type))
      availableQuestionTypes.value = [...types].sort()
      currentBankFile.value = fileName
      importedCache.set(fileName, questions.value)
    } catch (e) {
      questions.value = []
      availableQuestionTypes.value = []
      console.error('加载题目失败:', e)
      showToast(`加载题库失败 (${fileName})，请检查文件是否存在。`)
    } finally {
      if (showLoading) isLoading.value = false
    }
  }

  // ── 模式切换 ──
  function handleBankChange(newFileName: string) {
    if (isRefreshingBanks.value) return
    if (newFileName === currentBankFile.value) return
    flushSessionSave()
    answerSheet.value.clear()
    currentQuestionIndex.value = 0
    window.history.pushState({ mode: 'start', bank: newFileName }, '', '')
    try { localStorage.setItem(LAST_BANK_KEY, newFileName) } catch { /* 忽略 */ }
    loadQuestions(newFileName)
  }

  function handleBackToHome() {
    flushSessionSave()
    if (appMode.value !== 'start') appMode.value = 'start'
  }

  function handleStartSpecialize(types: string[]) {
    if (types.length === 0) return
    specializeTypes.value = types
    handleStartGame('specialize', true)
  }

  function handleStartGame(mode: AppMode, pushState = true) {
    renderError.value = ''
    if (mode === 'start' || !mode) { handleBackToHome(); return }

    // 管理/设置页面：直接切换，不初始化题目。
    if (mode === 'wrong-manage' || mode === 'settings' || mode === 'about') {
      flushSessionSave()
      appMode.value = mode
      if (pushState) {
        window.history.pushState({ mode, bank: currentBankFile.value }, '', '')
      }
      return
    }

    // 防御：题库未加载时阻止进入
    if (isRefreshingBanks.value || questions.value.length === 0) {
      showToast('题库尚未加载完成，请稍后再试。')
      return
    }

    if (pushState) {
      const st: Record<string, unknown> = { mode, bank: currentBankFile.value }
      if (mode === 'specialize') st.specializeTypes = [...specializeTypes.value]
      window.history.pushState(st, '', '')
    }

    score.value = 0
    let temp: Question[] = []

    // restore shuffle pref
    const savedShuffle = localStorage.getItem(shufflePrefKey.value)
    shuffleEnabled.value = savedShuffle === 'true'

    if (mode === 'practice') {
      temp = restoreOrBuild(practiceStateKey.value, () =>
        shuffleEnabled.value
          ? shuffleArray([...questions.value])
          : [...questions.value].sort((a, b) => a.number - b.number),
      )
    } else if (mode === 'wrong') {
      answerSheet.value.clear()
      currentQuestionIndex.value = 0
      const entries = quizStore.getWrongEntriesByBank(currentBankFile.value)
      if (entries.length > 0) {
        const qMap = new Map(questions.value.map((q) => [q.number, q]))
        const pairs = entries
          .map((e) => ({ q: qMap.get(e.questionNumber), id: e.id }))
          .filter((p): p is { q: Question; id: number } => p.q !== undefined)
        if (shuffleEnabled.value) {
          const shuf = shuffleArray([...pairs])
          temp = shuf.map((p) => p.q)
          wrongDisplayEntryIds.value = shuf.map((p) => p.id)
        } else {
          temp = pairs.map((p) => p.q)
          wrongDisplayEntryIds.value = pairs.map((p) => p.id)
        }
      } else {
        wrongDisplayEntryIds.value = []
      }
      // 恢复错题模式的答题记录
      const legacyKey = `wrong_session_${currentBankFile.value}`
      let wrongRaw = localStorage.getItem(wrongStateKey.value)
      // The old bank-wide session belongs only to the first notebook opened after migration.
      if (!wrongRaw && wrongStateKey.value !== legacyKey) {
        wrongRaw = localStorage.getItem(legacyKey)
        if (wrongRaw) {
          try {
            localStorage.setItem(wrongStateKey.value, wrongRaw)
            localStorage.removeItem(legacyKey)
          } catch { showToast('错题进度迁移保存失败，原进度已保留，请检查存储空间。') }
        }
      }
      if (wrongRaw) {
        try {
          const wrongState = JSON.parse(wrongRaw)
          if (wrongState.answers && Array.isArray(wrongState.answers)) {
            const restored = deserializeAnswerSheet(wrongState.answers)
            const validNumbers = new Set(temp.map((q) => q.number))
            for (const [num, entry] of restored) {
              if (validNumbers.has(num)) {
                answerSheet.value.set(num, entry)
              }
            }
          }
          if (typeof wrongState.currentIndex === 'number') {
            currentQuestionIndex.value = wrongState.currentIndex
          }
        } catch {
          blockedSessions.add(wrongStateKey.value)
          showToast('错题练习进度损坏，原数据已保留；请明确清空答题记录后再保存新进度。')
        }
      }
    } else if (mode === 'specialize') {
      if (specializeTypes.value.length === 0 && !pushState) {
        const saved = Object.keys(localStorage).filter((k) =>
          k.startsWith(`specialize_session_${currentBankFile.value}_`),
        )
        if (saved.length > 0) {
          specializeTypes.value = availableQuestionTypes.value.length > 0
            ? [...availableQuestionTypes.value]
            : [...QUESTION_TYPES]
        }
      }
      const key = `specialize_session_${currentBankFile.value}_${[...specializeTypes.value].sort().join('_')}`
      temp = restoreOrBuild(key, () =>
        shuffleEnabled.value
          ? shuffleArray(getQuestionsByTypes(specializeTypes.value, questions.value))
          : getQuestionsByTypes(specializeTypes.value, [...questions.value]).sort((a, b) => a.number - b.number),
      )
    } else {
      temp = restoreOrBuild(mode + '_session_' + currentBankFile.value, () => {
        const selected = shuffleArray([...questions.value])
        return mode === 'exam' ? selected.slice(0, 60) : selected
      })
    }

    // 仅对练习/专项模式兜底：筛选后无题目时回退到全部题目。
    // 错题模式筛空属正常情况（错题本为空或题号在当前题库不存在），
    // 应回退到空列表，而非把全部题目塞进错题模式。
    if (temp.length === 0 && questions.value.length > 0 && mode !== 'wrong') {
      console.warn('handleStartGame: 筛选后题目为空，回退到全部题目')
      temp = [...questions.value]
    }

    shuffledQuestions.value = temp
    const restoredIndex = Number.isInteger(currentQuestionIndex.value) ? currentQuestionIndex.value : 0
    currentQuestionIndex.value = Math.max(0, Math.min(restoredIndex, temp.length - 1))
    appMode.value = mode
    nextTick(() => window.scrollTo(0, 0))
  }

  /** 尝试从 localStorage 恢复 session，失败则调用 buildFn 新建 */
  function restoreOrBuild(key: string, buildFn: () => Question[]): Question[] {
    const raw = localStorage.getItem(key)
    if (!raw) {
      answerSheet.value.clear()
      currentQuestionIndex.value = 0
      return buildFn()
    }
    try {
      const state = JSON.parse(raw)
      if (state.schemaVersion !== undefined && state.schemaVersion !== 2) throw new Error('不支持的进度版本')
      if (!Array.isArray(state.answers) || !Array.isArray(state.order)) throw new Error('进度结构错误')
      answerSheet.value = state.answers ? deserializeAnswerSheet(state.answers) : new Map()
      if (state.order && Array.isArray(state.order)) {
        const qMap = new Map(questions.value.map((q) => [q.number, q]))
        const qs = state.order
          .map((n: number) => qMap.get(n))
          .filter(Boolean) as Question[]
        if (qs.length > 0) {
          const validNumbers = new Set(qs.map(question => question.number))
          answerSheet.value = new Map([...answerSheet.value].filter(([number]) => validNumbers.has(number)))
          currentQuestionIndex.value = typeof state.currentIndex === 'number' ? state.currentIndex : 0
          return qs
        }
      }
      answerSheet.value.clear()
      currentQuestionIndex.value = 0
      return buildFn()
    } catch {
      blockedSessions.add(key)
      showToast('练习进度损坏，原数据已保留；当前可临时练习，请导出备份或明确重置后再保存。')
      answerSheet.value.clear()
      currentQuestionIndex.value = 0
      return buildFn()
    }
  }

  // ── session 持久化（debounced，避免每次按键都序列化整个 Map）──
  // subAnswers 是 Map<number, SubAnswer>，JSON.stringify 会丢失，需手动转数组
  type SerializedAnswerSheetEntry = Omit<AnswerSheetEntry, 'subAnswers'> & {
    subAnswers?: [number, SubAnswer][] | Record<string, SubAnswer>
  }

  function serializeAnswerSheet(sheet: Map<number, AnswerSheetEntry>): [number, SerializedAnswerSheetEntry][] {
    return Array.from(sheet.entries()).map(([number, entry]) => {
      const { subAnswers, ...rest } = entry
      return [number, subAnswers instanceof Map
        ? { ...rest, subAnswers: Array.from(subAnswers.entries()) }
        : rest]
    })
  }

  function deserializeAnswerSheet(raw: [number, SerializedAnswerSheetEntry][]): Map<number, AnswerSheetEntry> {
    const map = new Map<number, AnswerSheetEntry>()
    for (const [number, entry] of raw) {
      if (Array.isArray(entry.subAnswers)) {
        map.set(number, { ...entry, subAnswers: new Map(entry.subAnswers) })
      } else if (entry.subAnswers && typeof entry.subAnswers === 'object') {
        const pairs = Object.entries(entry.subAnswers).map(([key, value]) => [Number(key), value] as const)
        map.set(number, { ...entry, subAnswers: new Map(pairs) })
      } else {
        map.set(number, {
          userAnswer: entry.userAnswer,
          isCorrect: entry.isCorrect,
          showResult: entry.showResult,
          subDrafts: entry.subDrafts,
        })
      }
    }
    return map
  }

  const blockedSessions = new Set<string>()
  let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null
  function sessionKey() {
    const mode = appMode.value
    if (mode === 'practice') return practiceStateKey.value
    if (mode === 'wrong') return wrongStateKey.value
    if (mode === 'specialize') return 'specialize_session_' + currentBankFile.value + '_' + [...specializeTypes.value].sort().join('_')
    if (mode === 'exam' || mode === 'endorse') return mode + '_session_' + currentBankFile.value
    return null
  }
  function saveBrowserSession() {
    const key = sessionKey()
    if (!key || blockedSessions.has(key) || localStorage.getItem('exam-restore-pending')) return
    try {
      localStorage.setItem(key, JSON.stringify({
        schemaVersion: 2, appVersion: '0.2.0', savedAt: Date.now(),
        bankFile: currentBankFile.value,
        answers: serializeAnswerSheet(answerSheet.value),
        currentIndex: currentQuestionIndex.value,
        order: appMode.value === 'wrong' ? [] : shuffledQuestions.value.map(q => q.number),
      }))
    } catch (error) { showToast('练习进度保存失败，请检查存储空间并及时备份：' + String(error)) }
  }
  function scheduleSessionSave() {
    saveBrowserSession()
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer)
    sessionSaveTimer = setTimeout(() => {
      sessionSaveTimer = null
      void persistLearningState().catch(() => { /* The global save-error handler reports failures. */ })
    }, 500)
  }
  function flushSessionSave() {
    if (sessionSaveTimer) { clearTimeout(sessionSaveTimer); sessionSaveTimer = null }
    saveBrowserSession()
    void persistLearningState().catch(() => { /* The global save-error handler reports failures. */ })
  }
  function saveWhenHidden() { if (document.visibilityState === 'hidden') flushSessionSave() }

  // ── 错题条目监听（增量更新） ──
  watch(
    () => quizStore.wrongEntries,
    () => {
      if (appMode.value !== 'wrong') return
      const entries = quizStore.getWrongEntriesByBank(currentBankFile.value)
      if (entries.length === 0) {
        shuffledQuestions.value = []
        wrongDisplayEntryIds.value = []
        currentQuestionIndex.value = 0
        return
      }
      const qMap = new Map(questions.value.map((q) => [q.number, q]))
      const newPairs = entries
        .map((e) => ({ q: qMap.get(e.questionNumber), id: e.id }))
        .filter((p): p is { q: Question; id: number } => p.q !== undefined)
      const newIdSet = new Set(newPairs.map((p) => p.id))
      const newQMap = new Map(newPairs.map((p) => [p.id, p.q]))
      const oldIds = wrongDisplayEntryIds.value
      const keptIds = oldIds.filter((id) => newIdSet.has(id))

      if (shuffleEnabled.value) {
        const oldIdSet = new Set(oldIds)
        const freshIds = newPairs.map((p) => p.id).filter((id) => !oldIdSet.has(id))
        const allIds = [...keptIds, ...freshIds]
        shuffledQuestions.value = allIds.map((id) => newQMap.get(id)!).filter(Boolean)
        wrongDisplayEntryIds.value = allIds
      } else {
        shuffledQuestions.value = newPairs.map((p) => p.q)
        wrongDisplayEntryIds.value = newPairs.map((p) => p.id)
      }
      if (currentQuestionIndex.value >= shuffledQuestions.value.length) {
        currentQuestionIndex.value = Math.max(0, shuffledQuestions.value.length - 1)
      }
    },
    { deep: true },
  )

  // ── 答案判分 ──
  function checkAnswer(q: Question, ua: UserAnswer): boolean {
    if (!ua || (Array.isArray(ua) && ua.length === 0)) return false
    let correct = q.answer
    let user = Array.isArray(ua) ? (ua as string[]).join('') : String(ua)
    if (q.answerFormat === 'markdown') { correct = stripMarkdown(correct); user = stripMarkdown(user) }
    switch (q.type) {
      case '多选题': return [...(Array.isArray(ua) ? ua : String(ua).split(''))].sort().join('') === q.answer.split('').sort().join('')
      case '填空题':
        if (q.answerDetail?.accepts?.length) {
          const trimmed = user.trim().toLowerCase()
          return q.answerDetail.accepts.some(answer => (q.answerFormat === 'markdown' ? stripMarkdown(answer) : answer).trim().toLowerCase() === trimmed)
        }
        return user.trim().toLowerCase() === correct.trim().toLowerCase()
      case '程序分析题': return user.trim() === correct.trim()
      default: return user.trim() === correct.trim()
    }
  }

  function handleAnswerUpdate(answer: UserAnswer, q: Question) {
    if (appMode.value === 'endorse') return
    const n = q.number
    const isAuto = ['practice', 'wrong', 'specialize'].includes(appMode.value) &&
      !['填空题', '程序分析题', '简答题', '编程题', '综合题', '综合应用题'].includes(q.type)
    if (isAuto) {
      answerSheet.value.set(n, { userAnswer: answer, isCorrect: checkAnswer(q, answer), showResult: true })
    } else {
      const old = answerSheet.value.get(n)
      const shouldReset = old?.showResult === true
      answerSheet.value.set(n, { userAnswer: answer, isCorrect: shouldReset ? null : (old?.isCorrect ?? null), showResult: shouldReset ? false : (old?.showResult ?? false) })
    }
    // 调度 session 持久化
    scheduleSessionSave()
  }

  function handleSubmit(q: Question) {
    if (!q) return
    const ans = answerSheet.value.get(q.number)?.userAnswer
    if (!ans || (Array.isArray(ans) && ans.length === 0)) { showToast('请先输入或选择一个答案！'); return }
    // 简答题不评判正确/错误，始终显示参考答案
    const isShort = q.type === '简答题'
    answerSheet.value.set(q.number, { userAnswer: ans, isCorrect: isShort ? null : checkAnswer(q, ans), showResult: true })
    scheduleSessionSave()
  }

  // ── 子题判分（根据子题类型） ──
  function checkSubAnswer(sub: SubQuestion, ua: string): boolean {
    const correct = sub.answerFormat === 'markdown' ? stripMarkdown(sub.answer) : sub.answer
    const user = sub.answerFormat === 'markdown' ? stripMarkdown(ua) : ua
    if (!ua || !ua.trim()) return false
    const subType = sub.type || '文本题'
    switch (subType) {
      case '单选题':
        return ua.trim().toUpperCase() === sub.answer.trim().toUpperCase()
      case '多选题':
        return ua.split('').sort().join('') === sub.answer.split('').sort().join('')
      case '填空题':
        if (sub.answerDetail?.accepts?.length) {
          const trimmed = user.trim().toLowerCase()
          return sub.answerDetail.accepts.some(answer => (sub.answerFormat === 'markdown' ? stripMarkdown(answer) : answer).trim().toLowerCase() === trimmed)
        }
        return user.trim().toLowerCase() === correct.trim().toLowerCase()
      default: // 文本题
        return user.trim().toLowerCase() === correct.trim().toLowerCase() && user.trim() !== ''
    }
  }

  function handleCompoundSubmit(q: Question, subs: Map<number, SubAnswer>) {
    const subQs = q.subQuestions || []
    let correctCount = 0
    for (const s of subQs) {
      const ua = subs.get(s.id)?.userAnswer || ''
      const ok = checkSubAnswer(s, ua)
      subs.set(s.id, { userAnswer: ua, isCorrect: ok })
      if (ok) correctCount++
    }
    answerSheet.value.set(q.number, {
      userAnswer: `复合题: ${correctCount}/${subQs.length} 正确`,
      isCorrect: correctCount === subQs.length,
      showResult: true,
      subAnswers: subs,
    })
    scheduleSessionSave()
  }

  function handleSubAnswerUpdate(q: Question, subId: number, answer: string) {
    if (appMode.value === 'endorse' || !q.subQuestions?.some(sub => sub.id === subId)) return
    const old = answerSheet.value.get(q.number)
    if (old?.subAnswers?.has(subId)) return
    answerSheet.value.set(q.number, {
      userAnswer: old?.userAnswer ?? null,
      isCorrect: old?.isCorrect ?? null,
      showResult: old?.showResult ?? false,
      subAnswers: old?.subAnswers,
      subDrafts: { ...old?.subDrafts, [subId]: answer },
    })
    scheduleSessionSave()
  }

  function handleSubSubmit(q: Question, subId: number, ua: string) {
    const subs = q.subQuestions || []
    const sub = subs.find((s) => s.id === subId)
    if (!sub) return
    const ok = checkSubAnswer(sub, ua)
    const old = answerSheet.value.get(q.number)
    const oldSub = old?.subAnswers
    const map = oldSub instanceof Map ? new Map(oldSub) : new Map<number, SubAnswer>()
    map.set(subId, { userAnswer: ua, isCorrect: ok })
    let cc = 0
    for (const s of subs) { if (map.get(s.id)?.isCorrect === true) cc++ }
    answerSheet.value.set(q.number, {
      userAnswer: `复合题: ${cc}/${subs.length} 正确`,
      isCorrect: map.size === subs.length ? cc === subs.length : null,
      showResult: old?.showResult || false,
      subAnswers: map,
      subDrafts: old?.subDrafts,
    })
    scheduleSessionSave()
  }

  function submitExam() {
    if (appMode.value !== 'exam') return
    let final = 0
    for (const q of shuffledQuestions.value) {
      const entry = answerSheet.value.get(q.number)
      if (q.subQuestions?.length) {
        const sa = new Map(entry?.subAnswers)
        for (const sub of q.subQuestions) {
          const draft = entry?.subDrafts?.[sub.id]
          if (!sa.has(sub.id) && draft?.trim()) {
            sa.set(sub.id, { userAnswer: draft, isCorrect: checkSubAnswer(sub, draft) })
          }
        }
        let cc = 0
        if (sa) for (const s of q.subQuestions) { if (sa.get(s.id)?.isCorrect === true) cc++ }
        if (!sa || sa.size === 0) {
          const ok = checkAnswer(q, entry?.userAnswer ?? null)
          answerSheet.value.set(q.number, { userAnswer: entry?.userAnswer ?? null, isCorrect: ok, showResult: true })
          if (ok) final++
        } else {
          answerSheet.value.set(q.number, { userAnswer: entry?.userAnswer ?? `复合题: ${cc}/${q.subQuestions.length} 正确`, isCorrect: cc === q.subQuestions.length, showResult: true, subAnswers: sa })
          if (cc === q.subQuestions.length) final++
        }
      } else {
        // 简答题不评判，不纳入分数
        const isShort = q.type === '简答题'
        const ok = isShort ? null : checkAnswer(q, entry?.userAnswer ?? null)
        answerSheet.value.set(q.number, { userAnswer: entry?.userAnswer ?? null, isCorrect: ok, showResult: true })
        if (ok === true) final++
      }
    }
    score.value = final
    localStorage.removeItem('exam_session_' + currentBankFile.value)
    appMode.value = 'review'
    void persistLearningState().catch(() => {})
  }

  // ── 工具栏操作 ──
  function handleToggleShuffle() {
    if (shuffleEnabled.value) {
      if (appMode.value === 'wrong') {
        const entries = quizStore.getWrongEntriesByBank(currentBankFile.value)
        const qMap = new Map(questions.value.map((q) => [q.number, q]))
        const pairs = entries.map((e) => ({ q: qMap.get(e.questionNumber), id: e.id })).filter((p): p is { q: Question; id: number } => p.q !== undefined)
        shuffledQuestions.value = pairs.map((p) => p.q)
        wrongDisplayEntryIds.value = pairs.map((p) => p.id)
      } else {
        shuffledQuestions.value = [...shuffledQuestions.value].sort((a, b) => a.number - b.number)
      }
    } else {
      if (appMode.value === 'specialize' && specializeTypes.value.length > 0) {
        shuffledQuestions.value = shuffleArray(getQuestionsByTypes(specializeTypes.value, questions.value))
      } else if (appMode.value === 'wrong') {
        const cur = shuffledQuestions.value.map((q, i) => ({ q, id: wrongDisplayEntryIds.value[i] ?? 0 }))
        const shuf = shuffleArray([...cur])
        shuffledQuestions.value = shuf.map((p) => p.q)
        wrongDisplayEntryIds.value = shuf.map((p) => p.id)
      } else {
        shuffledQuestions.value = shuffleArray([...questions.value])
      }
    }
    shuffleEnabled.value = !shuffleEnabled.value
    currentQuestionIndex.value = 0
    scheduleSessionSave()
    localStorage.setItem(shufflePrefKey.value, JSON.stringify(shuffleEnabled.value))
    nextTick(() => window.scrollTo(0, 0))
  }

  async function handleClearPractice() {
    const resetOk = await showConfirm('确定要重置当前做题进度吗？所有答题记录将被清空，题目顺序将重置。')
    if (!resetOk) return
    blockedSessions.delete(practiceStateKey.value)
    localStorage.removeItem(practiceStateKey.value)
    if (appMode.value === 'specialize') {
      const key = `specialize_session_${currentBankFile.value}_${[...specializeTypes.value].sort().join('_')}`
      blockedSessions.delete(key)
      localStorage.removeItem(key)
    }
    // 清除当前题库的活跃错题本标记，使下次「添加到错题本」新建一个错题本，
    // 而不是把重做后的错题追加到重置前的旧错题本中。
    quizStore.clearActiveNotebook(currentBankFile.value)
    // 清除上一轮的蒙对标记，避免重置后单题仍显示「已标记为蒙对」而无法重新添加到新错题本。
    quizStore.clearGuessedRightByBank(currentBankFile.value)
    answerSheet.value.clear()
    currentQuestionIndex.value = 0
    shuffleEnabled.value = false
    localStorage.setItem(shufflePrefKey.value, JSON.stringify(false))
    if (appMode.value === 'specialize' && specializeTypes.value.length > 0) {
      shuffledQuestions.value = [...getQuestionsByTypes(specializeTypes.value, questions.value)].sort((a, b) => a.number - b.number)
    } else {
      shuffledQuestions.value = [...questions.value].sort((a, b) => a.number - b.number)
    }
    score.value = 0
    scheduleSessionSave()
    window.scrollTo(0, 0)
  }

  function handleAddToWrongBook() {
    if (appMode.value === 'wrong') {
      handleAddToNewWrongBook()
      return
    }
    let count = 0
    let skippedExisting = 0
    let skippedCorrect = 0
    // 添加到当前活跃/默认错题本（与单题按钮同一个本），避免拆散错题。
    const nb = quizStore.getOrCreateDefaultNotebook(currentBankFile.value)
    const notebookId = nb.id
    // 仅在本错题本内去重（同本内不重复），不再跨错题本全局跳过。
    const existingNumbers = new Set(
      quizStore.getEntriesByNotebook(notebookId).map((e) => e.questionNumber),
    )

    for (const q of shuffledQuestions.value) {
      const entry = answerSheet.value.get(q.number)
      if (entry?.userAnswer !== null && entry?.userAnswer !== undefined) {
        const canAdd = entry.isCorrect === false || entry.isCorrect === null
        if (canAdd) {
          if (existingNumbers.has(q.number)) {
            skippedExisting++
          } else {
            quizStore.addWrongEntryToNotebook(q.number, currentBankFile.value, notebookId)
            existingNumbers.add(q.number)
            count++
          }
        } else if (entry.isCorrect === true) {
          skippedCorrect++
        }
        if (quizStore.isGuessedRight(q.number, currentBankFile.value) && !existingNumbers.has(q.number)) {
          quizStore.addWrongEntryToNotebook(q.number, currentBankFile.value, notebookId)
          existingNumbers.add(q.number)
          count++
        }
      }
    }
    const parts: string[] = []
    if (count > 0) parts.push(`已将 ${count} 道错题添加到错题本「${nb.name}」`)
    if (skippedExisting > 0) parts.push(`${skippedExisting} 道已在错题本中（跳过）`)
    if (skippedCorrect > 0) parts.push(`${skippedCorrect} 道回答正确（无需添加）`)
    if (count === 0 && parts.length === 0) {
      parts.push('没有新的错题需要添加')
    }
    showToast(parts.join('。') + '。')
  }

  function handleAddToNewWrongBook() {
    const bankFile = currentBankFile.value
    const source = quizStore.getActiveNotebook(bankFile)
    if (!source) return
    const wrongNumbers = new Set(shuffledQuestions.value.filter(q => {
      const entry = answerSheet.value.get(q.number)
      return entry?.isCorrect === false ||
        (entry?.subAnswers && [...entry.subAnswers.values()].some(sub => sub.isCorrect === false))
    }).map(q => q.number))
    if (wrongNumbers.size === 0) {
      showToast('本轮还没有再次答错的题目，请先答题后再添加。')
      return
    }

    const baseName = `${source.name} · 再练错题`
    const names = new Set(quizStore.getNotebooksByBank(bankFile).map(nb => nb.name))
    let name = baseName
    for (let suffix = 2; names.has(name); suffix++) name = `${baseName} (${suffix})`
    const notebook = quizStore.createNotebook(name, bankFile)
    for (const number of wrongNumbers) {
      quizStore.addWrongEntryToNotebook(number, bankFile, notebook.id)
    }
    // Creating a notebook activates it; keep the current practice bound to its source.
    quizStore.setActiveNotebook(bankFile, source.id)
    showToast(`已将 ${wrongNumbers.size} 道再次答错的题目添加到新错题本「${name}」。原错题本保持不变，可返回错题本列表开始新一轮练习。`)
  }

  async function handleClearWrong() {
    const clearOk = await showConfirm('确定要清空当前题库的所有错题吗？此操作不可恢复。')
    if (!clearOk) return
    quizStore.clearWrongEntriesByBank(currentBankFile.value)
    quizStore.clearGuessedRightByBank(currentBankFile.value)
    answerSheet.value.clear()
    shuffledQuestions.value = []
    currentQuestionIndex.value = 0
  }

  /** 清空错题模式的答题记录（保留错题本身，只重置答案和进度） */
  async function handleClearWrongAnswers() {
    const resetOk = await showConfirm('确定要清空错题中的所有答题记录吗？题目将保留，仅清空已填答案。')
    if (!resetOk) return
    answerSheet.value.clear()
    currentQuestionIndex.value = 0
    blockedSessions.delete(wrongStateKey.value)
    localStorage.removeItem(wrongStateKey.value)
    window.scrollTo(0, 0)
  }

  function exportWrongQuestions() {
    quizStore.exportWrongQuestions(questions.value, currentBankFile.value)
  }

  // ── 导入错题 ──
  const fileInput = ref<HTMLInputElement | null>(null)
  /** 待导入的错题文件内容缓存（processed file） */
  const pendingImportQuestions = ref<Question[] | null>(null)

  function importWrongQuestions() {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      void importWrongQuestionsFromNativePicker()
      return
    }
    fileInput.value?.click()
  }

  async function importWrongQuestionsFromNativePicker() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const selected = await open({ multiple: false, filters: [{ name: '错题 JSON', extensions: ['json'] }] })
      if (!selected || Array.isArray(selected)) return
      const content = await readTextFile(selected)
      const fileName = selected.replace(/\\/g, '/').split('/').pop() ?? 'wrong-questions.json'
      prepareWrongQuestionImport(content, fileName)
    } catch (error) {
      console.error('导入错题失败:', error)
      showToast('导入错题失败：' + (error instanceof Error ? error.message : '未知错误'))
    }
  }

  function prepareWrongQuestionImport(content: string, fileName: string) {
    try {
      const parsed = normalizeQuestionBank(JSON.parse(content), fileName)
      pendingImportQuestions.value = parsed
      importDialogNewNotebookName.value = fileName.replace(/\.json$/i, '')
      showImportDialog.value = true
    } catch (err) {
      console.error('导入失败:', err)
      showToast('导入失败，文件格式可能不正确。')
    }
  }

  async function handleFileImport(event: Event) {
    const inp = event.target as HTMLInputElement
    const file = inp.files?.[0]
    if (!file) { inp.value = ''; return }
    if (!isJsonFile(file)) {
      showToast('请选择一个有效的 JSON 文件')
      inp.value = ''
      return
    }
    try {
      prepareWrongQuestionImport(await readImportedText(file), file.name)
    } finally {
      inp.value = ''
    }
  }

  // ── 导入对话框状态 ──
  const showImportDialog = ref(false)
  const importDialogNewNotebookName = ref('')

  function confirmImportToNew() {
    const qs = pendingImportQuestions.value
    if (!qs || qs.length === 0) return
    const name = importDialogNewNotebookName.value.trim() || '导入错题 ' + new Date().toLocaleDateString()
    quizStore.importToNewNotebook(name, currentBankFile.value, qs)
    pendingImportQuestions.value = null
    showImportDialog.value = false
    importDialogNewNotebookName.value = ''
    showToast(`成功导入 ${qs.length} 道错题到新错题本「${name}」！`)
  }

  function confirmImportToExisting(notebookId: string) {
    const qs = pendingImportQuestions.value
    if (!qs || qs.length === 0) return
    quizStore.importToNotebook(notebookId, currentBankFile.value, qs)
    const nb = quizStore.notebooks.find((n) => n.id === notebookId)
    pendingImportQuestions.value = null
    showImportDialog.value = false
    showToast(`成功导入 ${qs.length} 道错题到「${nb?.name || notebookId}」！`)
  }

  function cancelImport() {
    pendingImportQuestions.value = null
    showImportDialog.value = false
    importDialogNewNotebookName.value = ''
  }

  // ── 从文件导入外部题库 ──
  let importingBank = false
  async function persistImportedBank(content: string, name: string) {
    if (importingBank) return
    importingBank = true
    try {
      const preview = inspectBank(content, name)
      if (preview.issues.length) throw new Error(bankIssueReport(preview))
      const types = Object.entries(preview.types).map(([type, count]) => type + ' ' + count).join('、')
      if (!await showConfirm('导入预览：' + name + '\n' + preview.questions.length + ' 道题 · ' + preview.imageCount + ' 张引用图片\n' + types + '\n图片须已在图库中或内嵌。确认保存？原文件不修改，同名不覆盖。')) return
      await savePublicBank(name.replace(/\.json$/i, '') || 'Imported bank', 'import-' + crypto.randomUUID(), preview.content, [], true, 'import')
    } finally { importingBank = false }
  }

  function handleExternalBankFileImport(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) { input.value = ''; return }
    if (!isJsonFile(file)) {
      showToast('请选择一个有效的 JSON 文件')
      input.value = ''
      return
    }
    void readImportedText(file)
      .then((content) => persistImportedBank(content, file.name))
      .catch((error) => {
        console.error('导入题库失败:', error)
        showToast('导入题库失败：' + (error instanceof Error ? error.message : '未知错误'))
      })
      .finally(() => { input.value = '' })
  }

  async function importExternalBank(): Promise<void> {
    const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    if (!isTauriEnv) {
      showToast('请使用应用内文件选择器导入 JSON 题库。')
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const selected = await open({ multiple: false, filters: [{ name: '题库 JSON', extensions: ['json'] }] })
      if (!selected || Array.isArray(selected)) return
      const content = await readTextFile(selected)
      const fileName = selected.replace(/\\/g, '/').split('/').pop() ?? 'unknown.json'
      await persistImportedBank(content, fileName)
    } catch (error) {
      console.error('导入题库失败:', error)
      showToast('导入题库失败：' + (error instanceof Error ? error.message : '未知错误'))
    }
  }

  // Navigation only changes session state; each presentation owns scrolling.
  function handleJumpTo(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= shuffledQuestions.value.length) return
    currentQuestionIndex.value = index
    scheduleSessionSave()
  }

  function handlePopState(event: PopStateEvent) {
    if (!event.state?.mode) { appMode.value = 'start'; return }
    if (event.state.mode === 'start') { appMode.value = 'start'; return }
    if (['wrong-manage', 'settings', 'about'].includes(event.state.mode)) {
      appMode.value = event.state.mode
      return
    }
    if (QUIZ_MODES.includes(event.state.mode)) {
      if (event.state.mode === 'specialize' && event.state.specializeTypes) {
        specializeTypes.value = event.state.specializeTypes
      }
      if (event.state.bank && event.state.bank !== currentBankFile.value) {
        currentBankFile.value = event.state.bank
        try { localStorage.setItem(LAST_BANK_KEY, event.state.bank) } catch { /* 忽略 */ }
        loadQuestions(event.state.bank).then(() => handleStartGame(event.state.mode, false))
      } else {
        handleStartGame(event.state.mode, false)
      }
    } else { appMode.value = 'start' }
  }

  async function handleGeneratedBankChange(event: Event) {
    try {
      generatedBanks.value = await listGeneratedBanks()
      const file = (event as CustomEvent<string>).detail
      if (file) {
        importedCache.delete(file)
        await loadQuestions(file, false)
        localStorage.setItem(LAST_BANK_KEY, file)
      } else if (currentBankFile.value.startsWith(GENERATED_BANK_PREFIX) && !generatedBanks.value.some((bank) => bank.file === currentBankFile.value)) {
        const fallback = allBanks.value[0]?.file ?? ''
        currentBankFile.value = fallback
        if (fallback) {
          localStorage.setItem(LAST_BANK_KEY, fallback)
          await loadQuestions(fallback, false)
        } else {
          localStorage.removeItem(LAST_BANK_KEY)
          questions.value = []
          availableQuestionTypes.value = []
          isLoading.value = false
        }
      }
    } catch (error) {
      console.error('刷新本地题库失败:', error)
      showToast('刷新本地题库失败，请重启应用后重试。')
    }
  }

  async function handlePublicBankChange(event: Event) {
    await refreshBanks()
    const file = (event as CustomEvent<string>).detail
    if (file && banks.value.some(bank => bank.file === file)) {
      await loadQuestions(file, false)
      localStorage.setItem(LAST_BANK_KEY, file)
    }
  }

  onMounted(async () => {
    window.addEventListener('pagehide', flushSessionSave)
    document.addEventListener('visibilitychange', saveWhenHidden)
    window.addEventListener(PUBLIC_BANKS_CHANGED, handlePublicBankChange)
    window.addEventListener(GENERATED_BANKS_CHANGED, handleGeneratedBankChange)
    await quizStore.persistedDataReady
    await refreshBanks()
    window.addEventListener('popstate', handlePopState)
  })

  onUnmounted(() => {
    window.removeEventListener('pagehide', flushSessionSave)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', saveWhenHidden)
    window.removeEventListener(PUBLIC_BANKS_CHANGED, handlePublicBankChange)
    flushSessionSave()
    window.removeEventListener('popstate', handlePopState)
    window.removeEventListener(GENERATED_BANKS_CHANGED, handleGeneratedBankChange)
  })

  // ── 返回 ──
  return {
    // state
    isLoading, isRefreshingBanks, questions, shuffledQuestions, currentQuestionIndex, score, appMode, answerSheet,
    currentBankFile, availableQuestionTypes, specializeTypes,
    shuffleEnabled, shufflePrefKey, wrongDisplayEntryIds, renderError, banks,
    // computed
    totalQuestions, wrongCount, allBanks,
    // actions
    loadQuestions, refreshBanks, handleBankChange, handleBackToHome, handleStartGame, handleStartSpecialize,
    handleAnswerUpdate, handleSubmit, handleCompoundSubmit, handleSubSubmit, handleSubAnswerUpdate, submitExam,
    handleToggleShuffle, handleClearPractice, handleAddToWrongBook, handleClearWrong,
    handleClearWrongAnswers,
    exportWrongQuestions, importWrongQuestions, handleFileImport, handleJumpTo,
    importExternalBank, handleExternalBankFileImport,
    fileInput,
    // notebook management
    showImportDialog, importDialogNewNotebookName, pendingImportQuestions,
    confirmImportToNew, confirmImportToExisting, cancelImport,
  }
}
