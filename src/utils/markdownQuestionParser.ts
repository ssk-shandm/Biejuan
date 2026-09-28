export type MarkdownQuestionRecord = {
  id: string
  number: number
  type: 'single' | 'multiple' | 'true-false' | 'fill' | 'short-answer' | 'program-analysis' | 'code' | 'compound'
  content: string
  format: 'text' | 'markdown'
  options?: Record<string, string>
  answer: string | boolean | string[]
  explanation?: string
  answerFormat?: 'text' | 'markdown'
  explanationFormat?: 'text' | 'markdown'
}

type ParsedQuestion = {
  chapter: number
  number: number
  content: string
  options: Record<string, string>
}

type ParsedAnswer = {
  chapter: number
  number: number
  answer: string
  explanation: string
}

const QUESTION_HEADING = /^\s*\*\*Q\s*([0-9]+(?:\s*&\s*Q\s*[0-9]+)*)\.\s*(.*?)\*\*\s*$/gm
const CHAPTER_HEADING = /^##\s*第\s*(\d+)\s*章[^\n]*$/gm
const QUESTION_NUMBER_HEADING = /^\s*\*\*(\d+)\.\*\*\s*(.*?)\s*$/gm
const ANSWER_HEADING = /^\s*\*\*(\d+)\.【答案】\s*([^*]*?)\*\*\s*$/gm

function normalizeText(value: string) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function cleanMarkdownText(value: string) {
  return value
    .replace(/^\s*\*\s*原答案\s*[：:]\s*/u, '')
    .replace(/^\s*\*\s*`?💡\s*速记提取\s*：?`?\s*/u, '')
    .replace(/\n\s*---\s*$/u, '')
    .trim()
}

function formatOf(...values: string[]) {
  return values.some((value) => /```|\|[^\n]+\|/u.test(value)) ? 'markdown' as const : 'text' as const
}

function inferQuestionType(content: string, answer: string, optionCount: number) {
  const text = `${content}\n${answer}`
  if (/判断题|正确或错误|对错/u.test(text)) return 'true-false' as const
  if (/填空题|填写/u.test(content)) return 'fill' as const
  if (/程序分析|代码题|编程题|代码/u.test(content)) return 'code' as const
  if (optionCount >= 2) return /多选/u.test(content) ? 'multiple' as const : 'single' as const
  return 'short-answer' as const
}

function extractSection(block: string, marker: RegExp, nextMarker: RegExp) {
  const match = marker.exec(block)
  if (!match || match.index === undefined) return ''
  const start = match.index + match[0].length
  const rest = block.slice(start)
  const end = rest.search(nextMarker)
  return cleanMarkdownText(end >= 0 ? rest.slice(0, end) : rest)
}

function parseOptions(value: string) {
  const optionPattern = /(?:^|[\n \t\u3000])([A-H])[.、:：]\s*/g
  const matches = [...value.matchAll(optionPattern)]
  if (matches.length < 2) return { content: cleanMarkdownText(value), options: {} as Record<string, string> }

  const options: Record<string, string> = {}
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!
    const key = match[1]!
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? value.length
    const optionValue = value.slice(start, end).trim()
    if (optionValue) options[key] = cleanMarkdownText(optionValue)
  }
  const first = matches[0]!
  const questionText = cleanMarkdownText(value.slice(0, first.index ?? 0))
  return { content: questionText, options }
}

function parseStructuredQuestions(text: string, startNumber: number) {
  const firstPart = text.search(/^#\s*第一部分[^\n]*$/m)
  const secondPart = text.search(/^#\s*第二部分[^\n]*$/m)
  const thirdPart = text.search(/^#\s*第三部分[^\n]*$/m)
  if (firstPart < 0 || secondPart < 0 || secondPart <= firstPart) return [] as MarkdownQuestionRecord[]

  const questionText = text.slice(firstPart, secondPart)
  const answerText = text.slice(secondPart, thirdPart >= 0 ? thirdPart : text.length)
  const questions: ParsedQuestion[] = []
  const answers: ParsedAnswer[] = []

  const questionChapters = [...questionText.matchAll(CHAPTER_HEADING)]
  for (let chapterIndex = 0; chapterIndex < questionChapters.length; chapterIndex += 1) {
    const chapterMatch = questionChapters[chapterIndex]!
    const chapter = Number(chapterMatch[1])
    const chapterStart = (chapterMatch.index ?? 0) + chapterMatch[0].length
    const chapterEnd = questionChapters[chapterIndex + 1]?.index ?? questionText.length
    const chapterBody = questionText.slice(chapterStart, chapterEnd)
    const questionHeadings = [...chapterBody.matchAll(QUESTION_NUMBER_HEADING)]
    for (let index = 0; index < questionHeadings.length; index += 1) {
      const heading = questionHeadings[index]!
      const questionNumber = Number(heading[1])
      const blockStart = heading.index ?? 0
      const blockEnd = questionHeadings[index + 1]?.index ?? chapterBody.length
      const block = chapterBody.slice(blockStart, blockEnd)
      const parsed = parseOptions(block.slice(heading[0].length))
      questions.push({ chapter, number: questionNumber, content: `${heading[2]!.trim()}${parsed.content ? `\n${parsed.content}` : ''}`.trim(), options: parsed.options })
    }
  }

  const answerChapters = [...answerText.matchAll(CHAPTER_HEADING)]
  for (let chapterIndex = 0; chapterIndex < answerChapters.length; chapterIndex += 1) {
    const chapterMatch = answerChapters[chapterIndex]!
    const chapter = Number(chapterMatch[1])
    const chapterStart = (chapterMatch.index ?? 0) + chapterMatch[0].length
    const chapterEnd = answerChapters[chapterIndex + 1]?.index ?? answerText.length
    const chapterBody = answerText.slice(chapterStart, chapterEnd)
    const answerHeadings = [...chapterBody.matchAll(ANSWER_HEADING)]
    for (let index = 0; index < answerHeadings.length; index += 1) {
      const heading = answerHeadings[index]!
      const questionNumber = Number(heading[1])
      const blockStart = heading.index ?? 0
      const blockEnd = answerHeadings[index + 1]?.index ?? chapterBody.length
      const block = chapterBody.slice(blockStart, blockEnd)
      const explanationMatch = block.match(/【解析】([\s\S]*?)(?=【对应笔记】|$)/u)
      answers.push({
        chapter,
        number: questionNumber,
        answer: heading[2]!.trim(),
        explanation: explanationMatch?.[1]?.trim() ?? '',
      })
    }
  }

  if (!questions.length) return [] as MarkdownQuestionRecord[]
  const answerMap = new Map(answers.map((item) => [`${item.chapter}:${item.number}`, item]))
  return questions.map((question, index) => {
    const answer = answerMap.get(`${question.chapter}:${question.number}`)
    const format = formatOf(question.content, ...Object.values(question.options), answer?.explanation ?? '')
    const record: MarkdownQuestionRecord = {
      id: `q-${question.chapter}-${question.number}`,
      number: Math.max(1, startNumber) + index,
      type: inferQuestionType(question.content, answer?.answer ?? '', Object.keys(question.options).length),
      content: question.content,
      format,
      answer: answer?.answer ?? '',
    }
    if (Object.keys(question.options).length) record.options = question.options
    if (answer?.explanation) record.explanation = answer.explanation
    if (format === 'markdown') {
      record.answerFormat = formatOf(answer?.answer ?? '')
      record.explanationFormat = formatOf(answer?.explanation ?? '')
    }
    return record
  })
}

/** Parse the two-part 240-question Markdown format used by the desktop import. */
export function parseStructuredExamMarkdown(sourceText: string, startNumber = 1) {
  return parseStructuredQuestions(normalizeText(sourceText), startNumber)
}

function parseLegacyMarkdownQuestions(text: string, startNumber: number) {
  const headings = [...text.matchAll(QUESTION_HEADING)]
  if (!headings.length) return [] as MarkdownQuestionRecord[]

  return headings.map((heading, index) => {
    const blockStart = heading.index ?? 0
    const blockEnd = headings[index + 1]?.index ?? text.length
    const block = text.slice(blockStart, blockEnd)
    const content = heading[2]!.replace(/\*\*/g, '').trim()
    const answer = extractSection(block, /^\s*\*\s*原答案\s*[：:]/mu, /^\s*\*\s*`?💡\s*速记提取/mu)
    const explanation = extractSection(block, /^\s*\*\s*`?💡\s*速记提取\s*：?`?/mu, /^\s*---\s*$/mu)
    const format = formatOf(content, answer, explanation)
    const number = Math.max(1, startNumber) + index
    const sourceNumbers = heading[1]!.replace(/\s+/g, '').replace(/&/g, '-')
    const record: MarkdownQuestionRecord = {
      id: `q-${sourceNumbers}-${number}`,
      number,
      type: inferQuestionType(content, answer, 0),
      content,
      format,
      answer,
    }
    if (explanation) record.explanation = explanation
    if (format === 'markdown') {
      record.answerFormat = formatOf(answer)
      record.explanationFormat = formatOf(explanation)
    }
    return record
  })
}

/**
 * Parse supported Markdown question formats. Generic Markdown without an
 * explicit question heading returns an empty array and remains LLM-driven.
 */
export function parseMarkdownQuestionBank(sourceText: string, startNumber = 1) {
  const text = normalizeText(sourceText)
  const structured = parseStructuredQuestions(text, startNumber)
  return structured.length ? structured : parseLegacyMarkdownQuestions(text, startNumber)
}
