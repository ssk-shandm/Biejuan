import { renderPromptMessages, type LlmPromptConfig, type LoadedLlmFramework } from '../utils/llmFramework'
import { LlmTruncatedError, type ChatMessage, type LlmClient, type LlmLogger } from './llmClient'

/**
 * AI 驱动的题库转换流水线（与 UI 无关，可在浏览器和 Node 中运行）：
 *
 * 1. 文本按行编号；
 * 2. analyze：模型阅读整份文档的轮廓，划分题目区 / 答案区 / 无关区并命名题库；
 * 3. convert：题目区按行切块并发转换，模型为每道题标注起止行号；
 * 4. 本地按行号合并去重，并按图片锚点所在行补挂图片；
 * 5. answer-match：存在独立答案区时，由模型按题号回填答案和解析；
 * 6. 逐题 Schema 校验，失败的题目交给 repair Prompt 修复。
 *
 * 文档结构的理解全部交给模型；本地只负责分块、行号对账和格式校验。
 */

export type QuestionRecord = Record<string, unknown>
export type ValidationResult = { valid: boolean; errors: string }
export type BankValidator = (value: unknown) => ValidationResult | Promise<ValidationResult>

export type ConvertOptions = {
  client: LlmClient
  framework: LoadedLlmFramework
  validate: BankValidator
  log: LlmLogger
  sourceName: string
  sourceText: string
  /** 用户指定的题库名称；为空时使用模型分析得到的名称 */
  bankName?: string
  startNumber?: number
  maxOutputTokens: number
  /** 图片 id（img-001）→ 最终写入题库的路径；在题库名称确定后调用 */
  resolveImagePath: (imageId: string, bankName: string) => string
  signal?: AbortSignal
}

export type ConvertStats = {
  lines: number
  sections: number
  chunks: number
  failedRanges: string[]
  questions: number
  answered: number
  answersMatched: number
  repaired: number
  dropped: number
  imagesAttached: number
}

export type ConvertResult = { bankName: string; questions: QuestionRecord[]; stats: ConvertStats }

type SourceLine = { number: number; text: string }
type SectionRole = 'questions' | 'answers' | 'ignore'
type Section = { startLine: number; endLine: number; role: SectionRole; title: string; hint: string }
type Chunk = { label: string; lines: SourceLine[]; continuation: SourceLine[]; sections: Section[] }
type Draft = {
  record: QuestionRecord
  startLine: number
  endLine: number
  sourceNumber: string
  section: string
}

const QUESTION_TYPES = ['single', 'multiple', 'true-false', 'fill', 'short-answer', 'program-analysis', 'code', 'compound'] as const
const SUB_QUESTION_TYPES = ['single', 'multiple', 'fill', 'short-answer', 'program-analysis', 'code'] as const
const TYPE_ALIASES: Record<string, string> = {
  单选: 'single', 单选题: 'single', 'single-choice': 'single', choice: 'single',
  多选: 'multiple', 多选题: 'multiple', 'multiple-choice': 'multiple', 'multi-choice': 'multiple',
  判断: 'true-false', 判断题: 'true-false', truefalse: 'true-false', true_false: 'true-false', judge: 'true-false', boolean: 'true-false',
  填空: 'fill', 填空题: 'fill', blank: 'fill', 'fill-in': 'fill', 'fill-blank': 'fill',
  简答: 'short-answer', 简答题: 'short-answer', 问答题: 'short-answer', 论述题: 'short-answer', shortanswer: 'short-answer', short_answer: 'short-answer', essay: 'short-answer',
  程序分析: 'program-analysis', 程序分析题: 'program-analysis', program_analysis: 'program-analysis', 读程序: 'program-analysis',
  编程: 'code', 编程题: 'code', 代码题: 'code', programming: 'code',
  综合: 'compound', 综合题: 'compound', 综合应用题: 'compound', 材料题: 'compound', 案例题: 'compound',
}
const QUESTION_START = /^\s*(?:第\s*)?(?:\d{1,4}|[一二三四五六七八九十]{1,3})\s*[.、．:：)）]|^\s*[（(]\s*\d{1,3}\s*[)）]|^\s*(?:Q|例|题|Question)\s*\d/i
const IMAGE_ANCHOR = /<source_image id="([^"]+)"\/>/g
const MAX_LINE_CHARACTERS = 1000
const CONTINUATION_CHARACTERS = 2500

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown) => (value == null ? '' : String(value)).trim()
const hasMarkdown = (...values: unknown[]) => values.some((value) => typeof value === 'string' && (value.includes('```') || /^\s*\|.+\|\s*$/m.test(value)))

// ── 行编号 ──

function wrapLongLine(line: string) {
  if (line.length <= MAX_LINE_CHARACTERS) return [line]
  const pieces: string[] = []
  let rest = line
  while (rest.length > MAX_LINE_CHARACTERS) {
    const window = rest.slice(0, MAX_LINE_CHARACTERS)
    const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('；'), window.lastIndexOf('. '), window.lastIndexOf(' '))
    const end = cut > MAX_LINE_CHARACTERS / 2 ? cut + 1 : MAX_LINE_CHARACTERS
    pieces.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  if (rest.trim()) pieces.push(rest)
  return pieces
}

export function toSourceLines(sourceText: string): SourceLine[] {
  const lines: SourceLine[] = []
  for (const raw of sourceText.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    for (const piece of wrapLongLine(line)) lines.push({ number: lines.length + 1, text: piece })
  }
  return lines
}

const numbered = (lines: SourceLine[], maxLineCharacters = Infinity) => lines.map((line) => {
  const body = line.text.length > maxLineCharacters ? `${line.text.slice(0, maxLineCharacters)}…` : line.text
  return `${line.number}| ${body}`
}).join('\n')

const charCount = (lines: SourceLine[]) => lines.reduce((sum, line) => sum + line.text.length + String(line.number).length + 3, 0)

// ── JSON 解析 ──

function stripCodeFence(content: string) {
  const trimmed = content.trim()
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? trimmed
}

/** 把字符串字面量里未转义的控制字符（制表符、换行等）转义，模型抄写原文代码时常见 */
function escapeControlCharactersInStrings(json: string) {
  let result = ''
  let inString = false
  let escaped = false
  for (const character of json) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      else if (character < ' ') {
        result += character === '\n' ? '\\n' : character === '\r' ? '\\r' : character === '\t' ? '\\t' : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        continue
      }
    } else if (character === '"') inString = true
    result += character
  }
  return result
}

function parseJsonLoose(content: string): unknown {
  const cleaned = escapeControlCharactersInStrings(stripCodeFence(content))
  try {
    return JSON.parse(cleaned)
  } catch (error) {
    const objectStart = cleaned.indexOf('{')
    const arrayStart = cleaned.indexOf('[')
    const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart)
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { /* 抛出原始错误 */ }
    }
    throw new Error(`模型输出不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}

function pickArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) throw new Error('模型输出的 JSON 根节点既不是对象也不是数组')
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[]
  const firstArray = Object.values(value).find(Array.isArray)
  if (firstArray) return firstArray as unknown[]
  if ('content' in value || 'type' in value) return [value]
  throw new Error(`模型输出中缺少 ${keys[0]} 数组`)
}

// ── 模型输出归一化 ──

function normalizeType(value: unknown) {
  const key = text(value).toLowerCase()
  if ((QUESTION_TYPES as readonly string[]).includes(key)) return key
  return TYPE_ALIASES[key] ?? TYPE_ALIASES[text(value)] ?? 'short-answer'
}

function normalizeOptions(value: unknown): Record<string, string> {
  const entries: Array<[string, string]> = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const raw = isRecord(item) ? text(item.text ?? item.content ?? item.value) : text(item)
      const key = isRecord(item) && /^[A-Z]$/i.test(text(item.key ?? item.label)) ? text(item.key ?? item.label).toUpperCase() : String.fromCharCode(65 + index)
      entries.push([key, raw])
    })
  } else if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) {
      const normalizedKey = key.trim().replace(/[.、．:：)）]$/, '').toUpperCase()
      if (/^[A-Z]$/.test(normalizedKey)) entries.push([normalizedKey, text(raw)])
    }
  }
  return Object.fromEntries(entries
    .map(([key, raw]) => [key, raw.replace(/^[A-Z]\s*[.、．:：)）]\s*/, '').trim()] as [string, string])
    .filter(([, raw]) => raw))
}

function choiceLetters(value: unknown, options: Record<string, string>) {
  const keys = new Set(Object.keys(options))
  const candidates = Array.isArray(value) ? value.map(text) : [text(value)]
  const letters: string[] = []
  for (const candidate of candidates) {
    const upper = candidate.toUpperCase().replace(/[\s,，、;；/|和及]+/g, '')
    if (/^[A-Z]+$/.test(upper)) letters.push(...upper.split(''))
    else {
      // 模型偶尔会写选项原文而不是字母
      const matched = Object.entries(options).find(([, optionText]) => optionText === candidate)
      if (matched) letters.push(matched[0])
    }
  }
  return [...new Set(letters)].filter((letter) => keys.has(letter)).sort()
}

function toTrueFalse(value: unknown): boolean | '' {
  if (typeof value === 'boolean') return value
  const key = text(value).toLowerCase().replace(/[。.!！]$/, '')
  if (['true', 't', '对', '正确', '√', '✓', '✔', '是', 'yes', 'y', '1'].includes(key)) return true
  if (['false', 'f', '错', '错误', '×', '✗', '✘', 'x', '否', 'no', 'n', '0'].includes(key)) return false
  return ''
}

function freeTextAnswer(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('；')
  if (isRecord(value)) return JSON.stringify(value)
  return text(value)
}

function answerFor(type: string, value: unknown, options: Record<string, string>): unknown {
  if (type === 'single') return choiceLetters(value, options)[0] ?? ''
  if (type === 'multiple') return choiceLetters(value, options)
  if (type === 'true-false') {
    // 原文判断题常写成“A、对 B、错”，答案给的是字母
    const letter = text(value).toUpperCase()
    return toTrueFalse(/^[A-Z]$/.test(letter) && options[letter] ? options[letter] : value)
  }
  return freeTextAnswer(value)
}

const isEmptyAnswer = (value: unknown) => value == null || value === '' || (Array.isArray(value) && value.length === 0)

function normalizeSubQuestion(raw: unknown, index: number): QuestionRecord | undefined {
  if (!isRecord(raw)) return undefined
  let type = normalizeType(raw.type)
  if (!(SUB_QUESTION_TYPES as readonly string[]).includes(type)) type = type === 'true-false' ? 'fill' : 'short-answer'
  const options = normalizeOptions(raw.options)
  if ((type === 'single' || type === 'multiple') && Object.keys(options).length < 2) type = 'short-answer'
  const content = text(raw.content ?? raw.question ?? raw.stem)
  if (!content) return undefined
  const answer = answerFor(type, raw.answer, options)
  const record: QuestionRecord = { id: index + 1, type, content, answer }
  if (hasMarkdown(content)) record.format = 'markdown'
  if (Object.keys(options).length) record.options = options
  if (hasMarkdown(answer)) record.answerFormat = 'markdown'
  if (text(raw.codeLanguage)) record.codeLanguage = text(raw.codeLanguage)
  if (type === 'multiple' && Array.isArray(answer) && answer.length === 1) record.answer = answer
  return record
}

function normalizeModelQuestion(raw: unknown, knownImages: Set<string>): Draft | undefined {
  if (!isRecord(raw)) return undefined
  const source = ['question', 'item', 'record'].map((key) => raw[key]).find(isRecord) ?? raw
  let type = normalizeType(source.type ?? source.questionType)
  let options = normalizeOptions(source.options)
  let content = text(source.content ?? source.question ?? source.stem ?? source.title)
  let scenario = text(source.scenario ?? source.material)
  const subQuestions = Array.isArray(source.subQuestions)
    ? source.subQuestions.map(normalizeSubQuestion).filter((item): item is QuestionRecord => Boolean(item))
    : []

  if (type === 'compound' && !subQuestions.length) type = 'short-answer'
  if (type === 'compound' && !content) {
    content = scenario
    scenario = ''
  }
  if ((type === 'single' || type === 'multiple') && Object.keys(options).length < 2) type = 'short-answer'
  if (type === 'single' && choiceLetters(source.answer, options).length > 1) type = 'multiple'
  const answer = type === 'compound' ? '' : answerFor(type, source.answer ?? source.correctAnswer, options)
  // 判断题的“对/错”选项由界面固定渲染，不写入题库
  if (type === 'true-false' || (type !== 'single' && type !== 'multiple' && Object.keys(options).length < 2)) options = {}
  const explanation = text(source.explanation ?? source.analysis)
  const record: QuestionRecord = { type, content, answer }
  if (Object.keys(options).length) record.options = options
  if (explanation) record.explanation = explanation
  if (scenario) record.scenario = scenario
  if (subQuestions.length && type === 'compound') record.subQuestions = subQuestions

  const accepts = isRecord(source.answerDetail) ? source.answerDetail.accepts : source.accepts
  if (Array.isArray(accepts)) {
    const values = [...new Set(accepts.map(text).filter(Boolean))]
    if (values.length) record.answerDetail = { accepts: values }
  }

  const images = Array.isArray(source.images)
    ? [...new Set(source.images.map((item) => text(item).match(/img-\d+/)?.[0] ?? '').filter((id) => knownImages.has(id)))]
    : []
  if (images.length) record.images = images
  // 题目是截图、只剩题号时，给出可读的占位题干
  if (images.length && /^[\s(（]*(?:\d{1,4}\s*[.、．:：)）]?|题干缺失)?[\s)）]*$/.test(String(record.content))) record.content = '（题目见图）'

  const markdown = hasMarkdown(content, scenario, explanation, answer, ...Object.values(options))
  record.format = markdown || source.format === 'markdown' ? 'markdown' : 'text'
  if (hasMarkdown(answer)) record.answerFormat = 'markdown'
  if (hasMarkdown(explanation)) record.explanationFormat = 'markdown'
  if (hasMarkdown(scenario)) record.scenarioFormat = 'markdown'
  if (text(source.codeLanguage)) record.codeLanguage = text(source.codeLanguage)

  const startLine = Number(source.startLine)
  const endLine = Number(source.endLine)
  return {
    record,
    startLine: Number.isInteger(startLine) && startLine > 0 ? startLine : 0,
    endLine: Number.isInteger(endLine) && endLine > 0 ? endLine : 0,
    sourceNumber: text(source.sourceNumber ?? source.number),
    section: '',
  }
}

// ── 并发 ──

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}

// ── 流水线 ──

export async function convertDocumentToQuestionBank(options: ConvertOptions): Promise<ConvertResult> {
  const { client, framework, log, signal } = options
  const settings = framework.framework.input ?? {}
  const prompts = framework.prompts
  const convertPrompt = prompts.convert
  if (!convertPrompt) throw new Error('框架中缺少 convert Prompt')

  const lines = toSourceLines(options.sourceText)
  if (!lines.length) throw new Error('文档中没有可转换的文本')
  const lineByNumber = new Map(lines.map((line) => [line.number, line]))
  const imageLines = new Map<string, number>()
  for (const line of lines) for (const match of line.text.matchAll(IMAGE_ANCHOR)) imageLines.set(match[1]!, line.number)
  const knownImages = new Set(imageLines.keys())
  const concurrency = Math.max(1, settings.concurrency ?? 4)
  const stats: ConvertStats = { lines: lines.length, sections: 0, chunks: 0, failedRanges: [], questions: 0, answered: 0, answersMatched: 0, repaired: 0, dropped: 0, imagesAttached: 0 }

  const chat = async (prompt: LlmPromptConfig, variables: Record<string, string>, label: string) => {
    const messages = renderPromptMessages(prompt, variables) as ChatMessage[]
    const result = await client.chat(messages, {
      jsonMode: prompt.response?.jsonObject === true,
      thinking: prompt.request?.thinking,
      label,
      signal,
    })
    return result.content
  }

  const validateRecord = async (record: QuestionRecord) => {
    const probe = { ...record, id: 'q-probe', number: 1 }
    return options.validate([probe])
  }

  // 1. 结构分析
  const analysis = await analyzeStructure()
  const sections = analysis.sections
  stats.sections = sections.length
  for (const section of sections) {
    log('info', `  ${section.startLine}-${section.endLine} 行 [${section.role}] ${section.title}${section.hint ? `：${section.hint}` : ''}`)
  }
  const sectionOf = (lineNumber: number) => sections.find((section) => lineNumber >= section.startLine && lineNumber <= section.endLine)

  // 2. 分块转换
  const outputBudget = Math.floor(options.maxOutputTokens * (settings.chunking?.outputTokenRatio ?? 0.6))
  const chunkLimit = Math.max(1200, Math.min(settings.chunking?.maxCharacters ?? 6000, outputBudget))
  const chunks = buildChunks(chunkLimit)
  stats.chunks = chunks.length
  log('command', `convert --chunks ${chunks.length} --chunk-chars ${chunkLimit} --concurrency ${concurrency}`)
  const chunkResults = await mapWithConcurrency(chunks, concurrency, async (chunk) => {
    try {
      const drafts = await convertChunk(chunk, 0)
      log('success', `[${chunk.label}] 识别 ${drafts.length} 道题`)
      return drafts
    } catch (error) {
      if (signal?.aborted) throw error
      const range = `${chunk.lines[0]!.number}-${chunk.lines.at(-1)!.number}`
      stats.failedRanges.push(range)
      log('error', `[${chunk.label}] 转换失败，第 ${range} 行的题目将缺失：${error instanceof Error ? error.message : String(error)}`)
      return [] as Draft[]
    }
  })
  if (chunks.length && stats.failedRanges.length === chunks.length) throw new Error('所有分段均转换失败，请查看终端日志')

  // 3. 合并去重 + 图片补挂
  const drafts = mergeDrafts(chunkResults.flat())
  attachOrphanImages(drafts)
  if (!drafts.length) throw new Error('模型没有从文档中识别出任何题目')

  // 4. 独立答案区匹配
  await matchAnswerSections(drafts)

  // 5. 编号、图片路径与整体校验
  const bankName = (options.bankName?.trim() || analysis.title || options.sourceName.replace(/\.[^.]+$/, '').trim() || 'question-bank').slice(0, 80)
  const startNumber = Math.max(1, Math.floor(options.startNumber ?? 1))
  const questions = drafts.map((draft, index) => {
    const number = startNumber + index
    const { images, ...rest } = draft.record
    const record: QuestionRecord = { id: `q-${number}`, number, ...rest }
    if (Array.isArray(images) && images.length) record.images = images.map((id) => options.resolveImagePath(String(id), bankName))
    return record
  })
  const check = await options.validate(questions)
  if (!check.valid) throw new Error(`合并后的题库未通过 Schema 校验：\n${check.errors}`)
  stats.questions = questions.length
  stats.answered = questions.filter((question) => question.type === 'compound' || !isEmptyAnswer(question.answer)).length
  return { bankName, questions, stats }

  // ── 以下为流水线各步骤 ──

  async function analyzeStructure(): Promise<{ title: string; sections: Section[] }> {
    const fallback = { title: '', sections: [{ startLine: 1, endLine: lines.length, role: 'questions' as const, title: '', hint: '' }] }
    const prompt = prompts.analyze
    if (!prompt) return fallback
    const maxCharacters = settings.analysis?.maxCharacters ?? 120000
    const maxLineCharacters = settings.analysis?.maxLineCharacters ?? 80
    const windows: SourceLine[][] = []
    let current: SourceLine[] = []
    let size = 0
    for (const line of lines) {
      const cost = Math.min(line.text.length, maxLineCharacters) + 8
      if (size + cost > maxCharacters && current.length) {
        windows.push(current)
        current = []
        size = 0
      }
      current.push(line)
      size += cost
    }
    if (current.length) windows.push(current)

    log('command', `analyze --lines ${lines.length} --windows ${windows.length}`)
    try {
      const results = await mapWithConcurrency(windows, concurrency, async (window, index) => {
        const first = window[0]!.number
        const last = window.at(-1)!.number
        const content = await chat(prompt, {
          sourceName: options.sourceName,
          lineCount: String(lines.length),
          windowInfo: windows.length > 1 ? `第 ${first}-${last} 行（全文分 ${windows.length} 次分析，这是第 ${index + 1} 次）` : `完整文档，第 ${first}-${last} 行`,
          outline: numbered(window, maxLineCharacters),
        }, windows.length > 1 ? `结构分析 ${index + 1}/${windows.length}` : '结构分析')
        const parsed = parseJsonLoose(content)
        const title = isRecord(parsed) ? text(parsed.title) : ''
        return { title, sections: sanitizeSections(pickArray(parsed, ['sections']), first, last) }
      })
      const title = results.find((result) => result.title)?.title ?? ''
      if (title) log('success', `模型识别的题库名称：${title}`)
      return { title, sections: results.flatMap((result) => result.sections) }
    } catch (error) {
      if (signal?.aborted) throw error
      log('warning', `结构分析失败，将按整篇文档直接转换：${error instanceof Error ? error.message : String(error)}`)
      return fallback
    }
  }

  function sanitizeSections(raw: unknown[], first: number, last: number): Section[] {
    const parsed = raw.filter(isRecord).map((item) => {
      const role = text(item.role).toLowerCase()
      return {
        startLine: Math.max(first, Math.floor(Number(item.startLine))),
        endLine: Math.min(last, Math.floor(Number(item.endLine))),
        role: (role === 'answers' || role === 'ignore' ? role : 'questions') as SectionRole,
        title: text(item.title).slice(0, 60),
        hint: text(item.hint).slice(0, 300),
      }
    }).filter((section) => Number.isFinite(section.startLine) && Number.isFinite(section.endLine) && section.endLine >= section.startLine)
      .sort((a, b) => a.startLine - b.startLine)

    // 去重叠，并把模型漏掉的行补成题目区（宁可多转换，不漏题）
    const result: Section[] = []
    let cursor = first
    for (const section of parsed) {
      const start = Math.max(section.startLine, cursor)
      if (start > section.endLine) continue
      if (start > cursor) result.push({ startLine: cursor, endLine: start - 1, role: 'questions', title: '', hint: '' })
      result.push({ ...section, startLine: start })
      cursor = section.endLine + 1
    }
    if (cursor <= last) result.push({ startLine: cursor, endLine: last, role: 'questions', title: '', hint: '' })
    return result
  }

  function buildChunks(limit: number): Chunk[] {
    const questionLines = lines.filter((line) => sectionOf(line.number)?.role === 'questions')
    const sectionSize = new Map(sections.map((section) => [section, charCount(lines.slice(section.startLine - 1, section.endLine))]))
    const groups: SourceLine[][] = []
    let current: SourceLine[] = []
    let size = 0
    let currentSection: Section | undefined
    for (const line of questionLines) {
      const cost = line.text.length + String(line.number).length + 3
      const section = sectionOf(line.number)
      // 新区段放不进当前分段的剩余空间时，从区段开头另起一段，避免大题（综合题、成套 SQL 题）被切开
      if (section !== currentSection) {
        currentSection = section
        if (current.length && section && size + (sectionSize.get(section) ?? 0) > limit) {
          groups.push(current)
          current = []
          size = 0
        }
      }
      if (size + cost > limit && current.length) {
        // 优先在疑似题目开头处切分，减少跨块题目
        let cut = current.length
        for (let index = current.length - 1; index >= Math.floor(current.length * 0.6); index -= 1) {
          if (QUESTION_START.test(current[index]!.text)) {
            cut = index
            break
          }
        }
        if (cut === 0) cut = current.length
        groups.push(current.slice(0, cut))
        current = current.slice(cut)
        size = charCount(current)
      }
      current.push(line)
      size += cost
    }
    if (current.length) groups.push(current)
    return groups.map((group, index) => createChunk(group, `分段 ${index + 1}/${groups.length}`))
  }

  function createChunk(group: SourceLine[], label: string): Chunk {
    const last = group.at(-1)!
    const lastSection = sectionOf(last.number)
    const continuation: SourceLine[] = []
    let size = 0
    for (let number = last.number + 1; lastSection && number <= lastSection.endLine; number += 1) {
      const line = lineByNumber.get(number)
      if (!line || size + line.text.length > CONTINUATION_CHARACTERS) break
      continuation.push(line)
      size += line.text.length
    }
    const sectionsInChunk = [...new Set(group.map((line) => sectionOf(line.number)).filter((section): section is Section => Boolean(section)))]
    return { label, lines: group, continuation, sections: sectionsInChunk }
  }

  async function convertChunk(chunk: Chunk, depth: number): Promise<Draft[]> {
    const first = chunk.lines[0]!.number
    const last = chunk.lines.at(-1)!.number
    const chunkImages = chunk.lines.flatMap((line) => [...line.text.matchAll(IMAGE_ANCHOR)].map((match) => match[1]!))
    const sectionTitle = chunk.sections.map((section) => section.title).filter(Boolean).join(' / ')
    const sectionHint = chunk.sections.length > 1
      ? chunk.sections.map((section) => `第 ${section.startLine} 行起「${section.title || '未命名'}」：${section.hint || '无'}`).join('；')
      : chunk.sections[0]?.hint ?? ''
    const variables = {
      bankName: options.bankName?.trim() || analysis.title || options.sourceName,
      sourceName: options.sourceName,
      sectionTitle,
      sectionHint,
      coreRange: `第 ${first} 行至第 ${last} 行`,
      imageManifestJson: JSON.stringify(chunkImages.map((id) => ({ id, line: imageLines.get(id) }))),
      sourceText: numbered(chunk.lines),
      continuationText: chunk.continuation.length ? numbered(chunk.continuation) : '（无）',
    }

    let raw: unknown[]
    try {
      const content = await chat(convertPrompt!, variables, chunk.label)
      raw = await parseOrRepairPayload(content, variables.sourceText, chunk.label)
    } catch (error) {
      if (error instanceof LlmTruncatedError && chunk.lines.length >= 4 && depth < 3) {
        const middle = Math.floor(chunk.lines.length / 2)
        log('warning', `[${chunk.label}] 输出被截断，拆成两段重新转换（第 ${first}-${last} 行）`)
        const left = createChunk(chunk.lines.slice(0, middle), `${chunk.label}.a`)
        left.continuation = [...chunk.lines.slice(middle), ...chunk.continuation].slice(0, 60)
        const right = { ...createChunk(chunk.lines.slice(middle), `${chunk.label}.b`), continuation: chunk.continuation }
        return [...await convertChunk(left, depth + 1), ...await convertChunk(right, depth + 1)]
      }
      throw error
    }

    const drafts: Draft[] = []
    const invalid: Array<{ raw: unknown; errors: string }> = []
    for (const item of raw) {
      const draft = normalizeModelQuestion(item, knownImages)
      if (!draft) continue
      if (draft.startLine && (draft.startLine < first || draft.startLine > last)) continue
      if (!draft.startLine) draft.startLine = first
      if (!draft.endLine || draft.endLine < draft.startLine) draft.endLine = draft.startLine
      draft.section = sectionOf(draft.startLine)?.title ?? ''
      const check = await validateRecord(draft.record)
      if (check.valid) drafts.push(draft)
      else invalid.push({ raw: item, errors: check.errors })
    }
    if (invalid.length) drafts.push(...await repairQuestions(invalid, variables.sourceText, chunk.label, first, last))
    return drafts
  }

  async function parseOrRepairPayload(content: string, sourceText: string, label: string): Promise<unknown[]> {
    try {
      return pickArray(parseJsonLoose(content), ['questions', 'items', 'data'])
    } catch (error) {
      const prompt = prompts.repair
      if (!prompt) throw error
      log('warning', `[${label}] ${error instanceof Error ? error.message : String(error)}，尝试修复 JSON`)
      const repaired = await chat(prompt, { invalidOutput: content, validationErrors: String(error instanceof Error ? error.message : error), sourceText }, `${label} 修复`)
      stats.repaired += 1
      return pickArray(parseJsonLoose(repaired), ['questions', 'items', 'data'])
    }
  }

  async function repairQuestions(invalid: Array<{ raw: unknown; errors: string }>, sourceText: string, label: string, first: number, last: number) {
    const prompt = prompts.repair
    const maxAttempts = framework.framework.pipeline?.find((step) => step.id === 'repair')?.maxAttempts ?? 2
    let pending = invalid
    const fixed: Draft[] = []
    for (let attempt = 1; prompt && pending.length && attempt <= maxAttempts; attempt += 1) {
      log('command', `[${label}] repair --questions ${pending.length} --attempt ${attempt}/${maxAttempts}`)
      const errors = pending.map((item, index) => `第 ${index + 1} 题：${item.errors.replace(/\n/g, '；')}`).join('\n')
      let repaired: unknown[]
      try {
        const content = await chat(prompt, { invalidOutput: JSON.stringify({ questions: pending.map((item) => item.raw) }, null, 1), validationErrors: errors, sourceText }, `${label} 修复`)
        repaired = pickArray(parseJsonLoose(content), ['questions', 'items', 'data'])
      } catch (error) {
        if (signal?.aborted) throw error
        log('warning', `[${label}] 修复请求失败：${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const stillInvalid: typeof pending = []
      for (const item of repaired) {
        const draft = normalizeModelQuestion(item, knownImages)
        if (!draft) continue
        if (!draft.startLine || draft.startLine < first || draft.startLine > last) draft.startLine = draft.startLine || first
        if (!draft.endLine || draft.endLine < draft.startLine) draft.endLine = draft.startLine
        draft.section = sectionOf(draft.startLine)?.title ?? ''
        const check = await validateRecord(draft.record)
        if (check.valid) {
          fixed.push(draft)
          stats.repaired += 1
        } else stillInvalid.push({ raw: item, errors: check.errors })
      }
      pending = stillInvalid
    }
    if (pending.length) {
      stats.dropped += pending.length
      log('warning', `[${label}] ${pending.length} 道题修复后仍未通过校验，已丢弃：${pending[0]!.errors.replace(/\n/g, '；').slice(0, 200)}`)
    }
    return fixed
  }

  function mergeDrafts(all: Draft[]) {
    const sorted = [...all].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine)
    const signature = (draft: Draft) => text(draft.record.content).replace(/\s+/g, '').slice(0, 80)
    const merged: Draft[] = []
    for (const draft of sorted) {
      const duplicate = [...merged].reverse().find((existing) =>
        existing.startLine === draft.startLine
        || (draft.startLine <= existing.endLine && signature(existing) === signature(draft)))
      if (!duplicate) {
        merged.push(draft)
        continue
      }
      // 同一道题被相邻分段重复识别时，保留信息更完整的一份
      if (JSON.stringify(draft.record).length > JSON.stringify(duplicate.record).length) merged[merged.indexOf(duplicate)] = draft
    }
    const removed = all.length - merged.length
    if (removed > 0) log('info', `按行号合并分段结果，去除重复题目 ${removed} 道`)
    return merged
  }

  function attachOrphanImages(drafts: Draft[]) {
    const claimed = new Set(drafts.flatMap((draft) => (Array.isArray(draft.record.images) ? draft.record.images.map(String) : [])))
    let unassigned = 0
    for (const [id, lineNumber] of imageLines) {
      if (claimed.has(id)) continue
      const owner = drafts.find((draft) => lineNumber >= draft.startLine && lineNumber <= draft.endLine)
      if (!owner) {
        if (sectionOf(lineNumber)?.role === 'questions') unassigned += 1
        continue
      }
      const images = Array.isArray(owner.record.images) ? owner.record.images.map(String) : []
      images.push(id)
      owner.record.images = images.sort((a, b) => (imageLines.get(a) ?? 0) - (imageLines.get(b) ?? 0))
      stats.imagesAttached += 1
    }
    if (stats.imagesAttached) log('info', `按图片锚点所在行补挂图片 ${stats.imagesAttached} 张`)
    if (unassigned) log('warning', `题目区有 ${unassigned} 张图片不在任何题目的行范围内，未关联到题目`)
  }

  async function matchAnswerSections(drafts: Draft[]) {
    const answerSections = sections.filter((section) => section.role === 'answers')
    const prompt = prompts['answer-match']
    if (!answerSections.length || !prompt) return
    // 待匹配目标：没有答案的普通题目，以及综合题里没有答案的小问（key 形如“12.3”）
    type Target = { draft: Draft; key: string; subId?: number; type: string; preview: string; parent?: string; options: Record<string, string> }
    const pending: Target[] = []
    drafts.forEach((draft, index) => {
      const record = draft.record
      const preview = text(record.content).replace(/\s+/g, ' ').slice(0, 60)
      if (record.type !== 'compound') {
        if (isEmptyAnswer(record.answer)) pending.push({ draft, key: String(index + 1), type: String(record.type), preview, options: isRecord(record.options) ? record.options as Record<string, string> : {} })
        return
      }
      for (const sub of Array.isArray(record.subQuestions) ? record.subQuestions.filter(isRecord) : []) {
        if (!isEmptyAnswer(sub.answer)) continue
        pending.push({
          draft, key: `${index + 1}.${sub.id}`, subId: Number(sub.id), type: String(sub.type), parent: preview,
          preview: text(sub.content).replace(/\s+/g, ' ').slice(0, 60),
          options: isRecord(sub.options) ? sub.options as Record<string, string> : {},
        })
      }
    })
    if (!pending.length) {
      log('info', '所有题目已带答案，跳过答案区匹配')
      return
    }
    const answerText = answerSections.map((section) => numbered(lines.slice(section.startLine - 1, section.endLine))).join('\n')
    const answerHint = answerSections.map((section) => `第 ${section.startLine}-${section.endLine} 行「${section.title}」${section.hint ? `：${section.hint}` : ''}`).join('；')
    const batchSize = Math.max(10, settings.answerMatching?.batchSize ?? 80)
    const batches: Array<typeof pending> = []
    for (let index = 0; index < pending.length; index += batchSize) batches.push(pending.slice(index, index + batchSize))
    log('command', `answer-match --questions ${pending.length} --batches ${batches.length}`)

    const byKey = new Map(pending.map((item) => [item.key, item]))
    await mapWithConcurrency(batches, concurrency, async (batch, index) => {
      const label = batches.length > 1 ? `答案匹配 ${index + 1}/${batches.length}` : '答案匹配'
      const questionsJson = JSON.stringify(batch.map((target) => ({
        key: target.key,
        section: target.draft.section,
        sourceNumber: target.subId === undefined ? target.draft.sourceNumber : `${target.draft.sourceNumber}（${target.subId}）`,
        type: target.type,
        ...(target.parent ? { parent: target.parent } : {}),
        preview: target.preview,
        ...(Object.keys(target.options).length ? { optionKeys: Object.keys(target.options).join('') } : {}),
      })))
      try {
        const content = await chat(prompt, { answerText, answerHint, questionsJson }, label)
        for (const item of pickArray(parseJsonLoose(content), ['answers', 'items'])) {
          if (!isRecord(item)) continue
          const target = byKey.get(text(item.key))
          if (!target) continue
          const { draft } = target
          const record = draft.record
          const answer = answerFor(target.type, item.answer, target.options)
          if (isEmptyAnswer(answer)) continue
          const explanation = text(item.explanation)
          let next: QuestionRecord
          if (target.subId === undefined) {
            next = { ...record, answer }
            if (explanation && !text(record.explanation)) {
              next.explanation = explanation
              if (hasMarkdown(explanation)) next.explanationFormat = 'markdown'
            }
            if (hasMarkdown(answer)) {
              next.answerFormat = 'markdown'
              next.format = 'markdown'
            }
          } else {
            // 小问没有 explanation 字段，解析并入外层题目的解析
            const subQuestions = (record.subQuestions as QuestionRecord[]).map((sub) => sub.id === target.subId
              ? { ...sub, answer, ...(hasMarkdown(answer) ? { answerFormat: 'markdown' } : {}) }
              : sub)
            next = { ...record, subQuestions }
            if (explanation) {
              next.explanation = [text(record.explanation), `（${target.subId}）${explanation}`].filter(Boolean).join('\n')
              if (hasMarkdown(next.explanation)) next.explanationFormat = 'markdown'
            }
            if (hasMarkdown(answer)) next.format = 'markdown'
          }
          if ((await validateRecord(next)).valid) {
            draft.record = next
            stats.answersMatched += 1
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error
        log('warning', `[${label}] 答案匹配失败，这批题目保持无答案：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    log('success', `答案区匹配完成：${stats.answersMatched}/${pending.length} 道题补全答案`)
  }
}
