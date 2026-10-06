import type { WrongNotebook, WrongQuestionEntry } from '../types'

/** v0.1 错题本格式；不包含题库、图片或做题会话，不等同于全量备份。 */
export interface QuizNotebookData {
  version: 1
  savedAt?: number
  notebooks: WrongNotebook[]
  wrongEntries: WrongQuestionEntry[]
  activeNotebookByBank: Record<string, string>
  guessedRight: { questionNumber: number; bankFile: string }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** 完整校验后才返回数据，避免恢复一半后才发现字段损坏。兼容缺少可选字段的 v1 备份。 */
export function validateQuizNotebookData(value: unknown): QuizNotebookData {
  if (!isRecord(value)) throw new Error('无效的错题本数据格式')
  if (value.version !== 1) throw new Error('不支持的错题本数据版本')
  if (value.savedAt !== undefined && !isTimestamp(value.savedAt)) throw new Error('savedAt 时间戳格式错误')
  if (!Array.isArray(value.notebooks)) throw new Error('缺少 notebooks 数组')
  if (!Array.isArray(value.wrongEntries)) throw new Error('缺少 wrongEntries 数组')

  const notebookBanks = new Map<string, string>()
  for (const [index, notebook] of value.notebooks.entries()) {
    if (!isRecord(notebook) || typeof notebook.id !== 'string' || !notebook.id.trim()
      || typeof notebook.name !== 'string' || typeof notebook.bankFile !== 'string'
      || !isTimestamp(notebook.createdAt)) {
      throw new Error('第 ' + (index + 1) + ' 个错题本字段不完整或类型错误')
    }
    if (notebookBanks.has(notebook.id)) throw new Error('错题本 ID 重复：' + notebook.id)
    notebookBanks.set(notebook.id, notebook.bankFile)
  }

  const entryIds = new Set<number>()
  for (const [index, entry] of value.wrongEntries.entries()) {
    if (!isRecord(entry) || !isPositiveInteger(entry.id) || !isPositiveInteger(entry.questionNumber)
      || typeof entry.bankFile !== 'string' || !isTimestamp(entry.addedAt)
      || (entry.notebookId !== undefined && typeof entry.notebookId !== 'string')) {
      throw new Error('第 ' + (index + 1) + ' 条错题记录字段不完整或类型错误')
    }
    if (entryIds.has(entry.id)) throw new Error('错题记录 ID 重复：' + entry.id)
    entryIds.add(entry.id)
    if (entry.notebookId !== undefined) {
      const bank = notebookBanks.get(entry.notebookId as string)
      // 兼容早期迁移将空 bankFile 的笔记本标成「(未知题库)」的情况。
      if (bank !== entry.bankFile && !(entry.bankFile === '' && bank === '(未知题库)')) {
        throw new Error('错题记录引用了不存在或不同题库的错题本')
      }
    }
  }

  const active = value.activeNotebookByBank ?? {}
  if (!isRecord(active)) throw new Error('activeNotebookByBank 必须是对象')
  for (const [bankFile, notebookId] of Object.entries(active)) {
    if (typeof notebookId !== 'string' || notebookBanks.get(notebookId) !== bankFile) {
      throw new Error('活跃错题本引用不存在或属于其他题库')
    }
  }
  const guessed = value.guessedRight ?? []
  if (!Array.isArray(guessed) || guessed.some(entry => !isRecord(entry)
    || !isPositiveInteger(entry.questionNumber) || typeof entry.bankFile !== 'string')) {
    throw new Error('guessedRight 必须是有效的蒙对记录数组')
  }
  return {
    version: 1,
    ...(value.savedAt === undefined ? {} : { savedAt: value.savedAt as number }),
    notebooks: value.notebooks as WrongNotebook[],
    wrongEntries: value.wrongEntries as WrongQuestionEntry[],
    activeNotebookByBank: active as Record<string, string>,
    guessedRight: guessed as QuizNotebookData['guessedRight'],
  }
}

export function parseQuizNotebookData(text: string): QuizNotebookData {
  return validateQuizNotebookData(JSON.parse(text.replace(/^\uFEFF/, '')))
}
