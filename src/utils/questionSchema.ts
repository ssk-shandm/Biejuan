import type {
  CanonicalQuestionType,
  ContentFormat,
  Question,
  QuestionSource,
  QuestionType,
  SubQuestion,
  SubQuestionSource,
} from '../types'
import { inheritedContentFormat, normalizeContentFormat } from './contentFormat'

const TYPE_MAP: Record<string, QuestionType> = {
  single: '单选题', 单选: '单选题', 单选题: '单选题',
  multiple: '多选题', 多选: '多选题', 多选题: '多选题',
  'true-false': '判断题', truefalse: '判断题', 判断: '判断题', 判断题: '判断题',
  fill: '填空题', 填空: '填空题', 填空题: '填空题',
  'short-answer': '简答题', 简答: '简答题', 简答题: '简答题',
  'program-analysis': '程序分析题', 程序分析: '程序分析题', 程序分析题: '程序分析题',
  code: '编程题', 编程: '编程题', 编程题: '编程题', 代码题: '编程题',
  compound: '综合题', 复合题: '综合题', 综合题: '综合题', SQL综合题: '综合题',
  综合应用题: '综合应用题',
}

const CANONICAL_TYPE_MAP: Record<QuestionType, CanonicalQuestionType> = {
  单选题: 'single', 多选题: 'multiple', 判断题: 'true-false', 填空题: 'fill',
  简答题: 'short-answer', 程序分析题: 'program-analysis', 编程题: 'code',
  综合题: 'compound', 综合应用题: 'compound',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('')
  if (value == null) return ''
  return String(value)
}

function normalizeOptions(value: unknown, path: string): Record<string, string> {
  if (value == null) return {}
  if (!isRecord(value)) throw new Error(`${path}.options 必须是键值对象`)
  return Object.fromEntries(Object.entries(value).map(([key, text]) => [key, String(text)]))
}

function normalizeAccepts(value: unknown, path: string) {
  if (value == null) return undefined
  if (!isRecord(value) || !Array.isArray(value.accepts)) {
    throw new Error(`${path}.answerDetail.accepts 必须是数组`)
  }
  return { accepts: value.accepts.map(String) }
}

export function normalizeQuestionType(value: unknown, path = '题目'): QuestionType {
  const key = String(value ?? '').trim()
  const normalized = TYPE_MAP[key]
  if (!normalized) throw new Error(`${path}.type 不受支持: ${key || '(空)'}`)
  return normalized
}

export function toCanonicalQuestionType(type: QuestionType): CanonicalQuestionType {
  return CANONICAL_TYPE_MAP[type]
}

function normalizeTrueFalseAnswer(answer: string): string {
  const normalized = answer.trim().toUpperCase()
  if (['T', 'TRUE', '正确', '对', 'YES', '1'].includes(normalized)) return 'A'
  if (['F', 'FALSE', '错误', '错', 'NO', '0'].includes(normalized)) return 'B'
  return answer
}

function normalizeSubQuestion(
  value: unknown,
  index: number,
  parentFormat: ContentFormat,
  parentAnswerFormat: ContentFormat,
  parentCodeLanguage?: string,
): SubQuestion {
  const path = `subQuestions[${index}]`
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`)
  const source = value as SubQuestionSource
  const question = String(source.content ?? source.question ?? '').trim()
  if (!question) throw new Error(`${path}.content 不能为空`)

  const rawType = String(source.type ?? '文本题')
  let type: SubQuestion['type'] = '文本题'
  if (['single', '单选', '单选题'].includes(rawType)) type = '单选题'
  else if (['multiple', '多选', '多选题'].includes(rawType)) type = '多选题'
  else if (['fill', '填空', '填空题'].includes(rawType)) type = '填空题'

  const format = normalizeContentFormat(source.format, parentFormat)
  const answerFormat = normalizeContentFormat(source.answerFormat,
    source.format == null ? parentAnswerFormat : inheritedContentFormat(format))
  return {
    id: Number.isFinite(source.id) ? Number(source.id) : index + 1,
    question,
    type,
    format,
    options: normalizeOptions(source.options, path),
    answer: normalizeAnswer(source.answer),
    answerDetail: normalizeAccepts(source.answerDetail, path),
    answerFormat,
    codeLanguage: source.codeLanguage ?? parentCodeLanguage,
  }
}

function normalizeQuestion(value: unknown, index: number, sourceName: string): Question {
  const path = `${sourceName}[${index}]`
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`)
  const source = value as QuestionSource
  const question = String(source.content ?? source.question ?? '').trim()
  if (!question) throw new Error(`${path}.content（或旧字段 question）不能为空`)

  const type = normalizeQuestionType(source.type, path)
  const format = normalizeContentFormat(source.format)
  const inheritedFormat = inheritedContentFormat(format)
  const answerFormat = normalizeContentFormat(source.answerFormat, inheritedFormat)
  const scenarioFormat = normalizeContentFormat(source.scenarioFormat, inheritedFormat)
  const explanationFormat = normalizeContentFormat(source.explanationFormat, inheritedFormat)
  let answer = normalizeAnswer(source.answer)
  if (type === '判断题') answer = normalizeTrueFalseAnswer(answer)

  const rawSubQuestions = source.subQuestions
  if (rawSubQuestions != null && !Array.isArray(rawSubQuestions)) {
    throw new Error(`${path}.subQuestions 必须是数组`)
  }

  return {
    id: source.id == null ? undefined : String(source.id),
    number: Number.isFinite(source.number) ? Number(source.number) : index + 1,
    type,
    question,
    format,
    options: normalizeOptions(source.options, path),
    answer,
    explanation: String(source.explanation ?? ''),
    wrongDescription: String(source.wrongDescription ?? ''),
    answerDetail: normalizeAccepts(source.answerDetail, path),
    images: Array.isArray(source.images) ? source.images.map(String) : [],
    answerFormat,
    explanationFormat,
    codeLanguage: source.codeLanguage,
    scenario: source.scenario == null ? undefined : String(source.scenario),
    scenarioFormat,
    subQuestions: rawSubQuestions?.map((sub, subIndex) =>
      normalizeSubQuestion(sub, subIndex, inheritedFormat, answerFormat, source.codeLanguage),
    ),
  }
}

/** 验证并规范化整个题库。兼容旧字段，并为缺省字段补全安全默认值。 */
export function normalizeQuestionBank(input: unknown, sourceName = '题库'): Question[] {
  if (!Array.isArray(input)) throw new Error(`${sourceName} 根节点必须是题目数组`)
  const questions = input.map((item, index) => normalizeQuestion(item, index, sourceName))
  const seen = new Set<number>()
  for (const question of questions) {
    if (seen.has(question.number)) throw new Error(`${sourceName} 存在重复题号: ${question.number}`)
    seen.add(question.number)
  }
  return questions
}
