/**
 * 文档结构特征提取模块。
 *
 * 不假设文档是任何特定考试或格式，只做三件事：
 * 1. 统计行级别特征（题号格式、选项标记、答案标记、分隔符等）
 * 2. 输出"文档签名"，供 AI analyze 步骤参考
 * 3. 预测可能的答案区起始行（仅作为线索，AI 可以采纳或忽略）
 *
 * 所有具体判断（题型推断、答案格式识别、材料区检测）全部交给 AI。
 */

export type DocSignature = {
  totalLines: number
  charCount: number
  /** 文档中出现的部分/节标题样本（如 Part I, Section A, 一、） */
  structuralHeaders: string[]
  /** 题号编号风格 */
  numberingStyle: 'continuous' | 'chaptered' | 'single-digits' | 'mixed' | 'none'
  /** 前 10 个题号的格式 */
  questionNumberSamples: string[]
  /** 选项标记样本 */
  optionMarkSamples: string[]
  /** 各种可识别的答案标记样本 */
  answerMarkerSamples: string[]
  /** 含有“题目”“题干”等关键词的题号重述行数 */
  restatedQuestionLineCount: number
  /** 疑似答案区起始行号（0 表示无法判断） */
  estimatedAnswerStartLine: number
  /** 是否检测到题目被完整重述（题目+选项反复出现在文档后半部分） */
  hasQuestionRestatements: boolean
  /** 解析标记样本（如信号词、定位说明等） */
  analysisMarkerSamples: string[]
}

type IndexedLine = { number: number; text: string }

/**
 * 通用正则 —— 不绑定具体格式，只做最广泛匹配。
 */
/** 各种编号开头：数字、中文数字、字母+分隔符 */
const NUMBERED_LINE = /^\s*(?:\d{1,4}|[一二三四五六七八九十]+)\s*[.、．:：)）\s]/
/** 严格题号：数字后紧跟题号分隔符（1. / 1) / (1) / 1、），用于采集题号样例 */
const STRICT_QUESTION_NUMBER = /^\s*(?:\(?\d{1,4}[)）.、．:：]|\d{1,4}\s*[.、)）])\s*\S/
/** 中英文选项前缀：A. A) A、A: (A) */
const OPTION_PREFIX = /^\s*(?:[A-Za-z]\)|[A-Za-z][.、．:：]|[（(][A-Za-z][)）])\s/
/** 结构分隔符：Part / Section / Chapter / 一、/ 第X章 */
const STRUCTURAL_HEADER = /^\s*(?:Part|Section|Chapter|Unit|Lesson|Module)\s+\S/i
/** 答案标记（不限于中文）：【答案】Answer: Key: 参考答案 答案 标准答案 */
const ANSWER_MARKER = /^\s*(?:【答案】|Answer[\s:：]|Key[\s:：]|参考答案|标准答案|答案[：:])/i
/** 题目重述标记：【题目】Question: */
const QUESTION_MARKER = /^\s*(?:【题目】|Question[\s:：])/i
/** 解析标记特征——标记后跟长文本 */
const ANALYSIS_MARKER_PREFIX = /^\s*【[^】]{1,10}】/
/** 翻译标记 */
const TRANSLATION_MARKER = /^\s*【翻译】/
/**
 * 易误判为答案标记的说明性文本（如 "Answer Sheet 1 with a single line..."、答题说明）。
 * 与答案标记同时命中时优先按说明处理，避免把卷面说明误认为答案区起点。
 */
const INSTRUCTION_LINE = /(?:Answer\s+Sheet|答题卡|答题纸|mark\s+the\s+corresponding|write\s+your\s+answer\s+on|single\s+line\s+through)/i

const PAGE_BREAK = '\f'

/**
 * 提取文档签名，不预设文档类型。
 */
export function extractDocSignature(lines: IndexedLine[]): DocSignature {
  if (!lines.length) {
    return emptySignature()
  }

  const structuralHeaders: string[] = []
  const questionNumberSamples: string[] = []
  const strictNumberSamples: string[] = []
  const optionMarkSamples: string[] = []
  const answerMarkerSamples: string[] = []
  const analysisMarkerSamples: string[] = []
  let restatedQuestionLineCount = 0
  let firstAnswerMarkerLine = 0
  let charCount = 0

  for (const line of lines) {
    const t = line.text.trim()
    if (!t || t === PAGE_BREAK) continue
    charCount += t.length

    // 结构分隔符
    if (STRUCTURAL_HEADER.test(t)) {
      if (structuralHeaders.length < 8) structuralHeaders.push(t.slice(0, 40))
    }

    // 题号（数字开头行）。优先采集「数字紧跟分隔符」的严格题号行，
    // 避免把 "30 minutes to write..." 这类正文误当题号。
    if (NUMBERED_LINE.test(t)) {
      if (STRICT_QUESTION_NUMBER.test(t)) {
        if (strictNumberSamples.length < 10) strictNumberSamples.push(t.slice(0, 40))
      } else if (questionNumberSamples.length < 10) {
        questionNumberSamples.push(t.slice(0, 40))
      }
    }

    // 选项前缀
    if (OPTION_PREFIX.test(t)) {
      if (optionMarkSamples.length < 5) optionMarkSamples.push(t.slice(0, 30))
    }

    // 答案标记（排除答题说明等易误判文本）
    if (ANSWER_MARKER.test(t) && !INSTRUCTION_LINE.test(t)) {
      if (!firstAnswerMarkerLine) firstAnswerMarkerLine = line.number
      if (answerMarkerSamples.length < 5) answerMarkerSamples.push(t.slice(0, 50))
    }

    // 题目重述标记
    if (QUESTION_MARKER.test(t)) {
      restatedQuestionLineCount++
    }

    // 解析标记（【信号】【定位】【替换】等）
    if (ANALYSIS_MARKER_PREFIX.test(t) && !ANSWER_MARKER.test(t) && !QUESTION_MARKER.test(t) && !TRANSLATION_MARKER.test(t)) {
      if (analysisMarkerSamples.length < 5) analysisMarkerSamples.push(t.slice(0, 40))
    }
  }

  // 编号风格判断：优先用严格题号样例，没有时退回宽松样例
  const samplesForNumbering = strictNumberSamples.length ? strictNumberSamples : questionNumberSamples
  const numberingStyle = detectNumberingStyle(samplesForNumbering)
  const hasQuestionRestatements = restatedQuestionLineCount > 2 || (firstAnswerMarkerLine > 0 && structuralHeaders.some(h => /答案|解析|Answer|Key/i.test(h)))

  // 预估答案区起始行：第一个答案标记往前推少量行
  const estimatedAnswerStartLine = firstAnswerMarkerLine > 0 ? Math.max(1, firstAnswerMarkerLine - 5) : 0

  return {
    totalLines: lines.length,
    charCount,
    structuralHeaders: [...new Set(structuralHeaders)],
    numberingStyle,
    questionNumberSamples: (strictNumberSamples.length ? strictNumberSamples : questionNumberSamples).slice(0, 10),
    optionMarkSamples: [...new Set(optionMarkSamples)],
    answerMarkerSamples: [...new Set(answerMarkerSamples)],
    restatedQuestionLineCount,
    estimatedAnswerStartLine,
    hasQuestionRestatements,
    analysisMarkerSamples: [...new Set(analysisMarkerSamples)],
  }
}

function detectNumberingStyle(samples: string[]): DocSignature['numberingStyle'] {
  if (!samples.length) return 'none'

  // 收集题号值
  const numbers = samples.map(s => {
    const m = s.trim().match(/^\s*(\d{1,4})/)
    return m && m[1] ? parseInt(m[1], 10) : 0
  }).filter(n => n > 0)

  if (numbers.length < 2) return 'single-digits'

  // 检查是否是连续编号（差值多为1）
  const gaps: number[] = []
  for (let i = 1; i < numbers.length; i++) {
    gaps.push(numbers[i]! - numbers[i - 1]!)
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (Math.abs(avgGap - 1) < 0.3) return 'continuous'

  // 检查是否是分章编号（如 1.1, 2.3）
  const hasDotInNumber = samples.some(s => /\d+\.\d+/.test(s))
  if (hasDotInNumber) return 'chaptered'

  // 数字跳跃大或混合
  if (numbers.length > 2 && Math.max(...numbers) - Math.min(...numbers) > 50) return 'continuous'

  return 'mixed'
}

function emptySignature(): DocSignature {
  return {
    totalLines: 0, charCount: 0, structuralHeaders: [],
    numberingStyle: 'none', questionNumberSamples: [],
    optionMarkSamples: [], answerMarkerSamples: [],
    restatedQuestionLineCount: 0, estimatedAnswerStartLine: 0,
    hasQuestionRestatements: false, analysisMarkerSamples: [],
  }
}

/**
 * 把文档签名渲染成 AI 可读的描述文本。
 */
export function signatureToDescription(sig: DocSignature): string {
  const parts: string[] = []
  parts.push(`文档统计：${sig.totalLines} 行，${sig.charCount} 字符`)

  if (sig.structuralHeaders.length) {
    parts.push(`结构分隔符：${sig.structuralHeaders.slice(0, 5).join('、')}`)
  }

  parts.push(`题号风格：${styleLabel(sig.numberingStyle)}`)
  if (sig.questionNumberSamples.length) {
    parts.push(`题号样例（前${Math.min(sig.questionNumberSamples.length, 5)}个）：${sig.questionNumberSamples.slice(0, 5).map(s => s.slice(0, 30)).join(' | ')}`)
  }

  if (sig.optionMarkSamples.length) {
    parts.push(`选项标记：${sig.optionMarkSamples.slice(0, 3).join('；')}`)
  }

  if (sig.answerMarkerSamples.length) {
    parts.push(`答案标记（${sig.answerMarkerSamples.length} 种）：${sig.answerMarkerSamples.slice(0, 3).join('；')}`)
    if (sig.estimatedAnswerStartLine) {
      parts.push(`答案区可能起始于第 ${sig.estimatedAnswerStartLine} 行附近（仅供参考，请 AI 确认或修正）`)
    }
  }

  if (sig.hasQuestionRestatements) {
    parts.push(`检测到题目重述标记 ${sig.restatedQuestionLineCount} 处——文档后半部分可能包含与前半部重复的题目内容`)
  }

  if (sig.analysisMarkerSamples.length) {
    parts.push(`解析标记样例：${sig.analysisMarkerSamples.slice(0, 3).join('；')}`)
  }

  parts.push(`\n请 AI 根据以上特征判断文档类型（考试试卷/习题集/讲义/笔记等），并输出精准的区段划分。`)
  return parts.join('\n')
}

function styleLabel(s: DocSignature['numberingStyle']): string {
  return { continuous: '连续编号（1,2,3...）', chaptered: '分章编号（1.1, 1.2...）', 'single-digits': '少量数字', mixed: '混合', none: '无编号' }[s] ?? s
}

/** @deprecated 兼容旧导入 */
export type { IndexedLine }
