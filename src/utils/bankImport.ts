import { normalizeQuestionBank, normalizeQuestionType } from './questionSchema'
import type { Question } from '../types'

export interface BankIssue { question: string; field: string; reason: string; suggestion: string }
export interface BankInspection {
  name: string
  content: string
  questions: Question[]
  issues: BankIssue[]
  /** 不阻断保存的问题（例如 AI 转换出的待补答案草稿），由调用方决定是否提示 */
  warnings: BankIssue[]
  types: Record<string, number>
  imageCount: number
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 提示里带上题号与题干摘要，方便直接在题库中定位要补答案的题 */
function labelWithContent(value: Record<string, unknown>, label: string): string {
  const content = String(value.content ?? value.question ?? '').replace(/\s+/g, ' ').trim()
  return content ? `${label}「${content.slice(0, 40)}${content.length > 40 ? '…' : ''}」` : label
}

export type BankInspectionOptions = {
  /**
   * 允许题目暂时没有答案（AI 转换出的草稿）。此时缺答案只记入 warnings，
   * 不阻断保存；人工导入仍保持严格校验。
   */
  allowMissingAnswers?: boolean
}

/** Collect every actionable error before any file or learning record is written. */
export function inspectBank(content: string, name: string, options: BankInspectionOptions = {}): BankInspection {
  const result: BankInspection = { name, content: content.replace(/^\uFEFF/, ''), questions: [], issues: [], warnings: [], types: {}, imageCount: 0 }
  const issue = (question: string, field: string, reason: string, suggestion: string) => result.issues.push({ question, field, reason, suggestion })
  const warn = (question: string, field: string, reason: string, suggestion: string) => result.warnings.push({ question, field, reason, suggestion })
  let raw: unknown
  try { raw = JSON.parse(result.content) } catch {
    issue('文件', 'JSON', 'JSON 语法损坏或编码错误', '使用 UTF-8 保存，检查引号、逗号和括号')
    return result
  }
  if (!Array.isArray(raw) || !raw.length) {
    issue('文件', '根节点', '题库必须是非空题目数组', '参考设置中的题库格式示例')
    return result
  }
  const ids = new Set<string>()
  const numbers = new Set<number>()
  const imagePaths = new Set<string>()
  for (const [index, item] of raw.entries()) {
    const label = `第 ${index + 1} 题`
    if (!record(item)) { issue(label, '题目', '题目不是对象', '改为包含 type、content 和 answer 的对象'); continue }
    if (typeof (item.content ?? item.question) !== 'string') issue(label, 'content', '题干必须是文本字符串', '将题干放入 content 字符串，不要使用对象或数组')
    for (const field of ['explanation', 'scenario', 'codeLanguage', 'wrongDescription']) {
      if (item[field] !== undefined && typeof item[field] !== 'string') issue(label, field, '字段必须是字符串', '改为文本字符串或移除此可选字段')
    }
    for (const field of ['format', 'answerFormat', 'explanationFormat', 'scenarioFormat']) {
      if (item[field] !== undefined && !['text', 'txt', 'plain-text', 'plaintext', 'markdown', 'md', 'mermaid', 'mmd', 'plantuml', 'puml', 'uml'].includes(String(item[field]).trim().toLowerCase())) issue(label, field, '未知内容格式', '使用 text、markdown、mermaid 或 plantuml；代码请使用 Markdown 代码块')
    }
    if (item.images !== undefined && (!Array.isArray(item.images) || item.images.some(value => typeof value !== 'string' || !value.trim()))) issue(label, 'images', '图片引用必须是非空字符串数组', '使用路径数组或移除此可选字段')
    const number = item.number ?? index + 1
    if (!Number.isSafeInteger(number) || Number(number) <= 0 || numbers.has(Number(number))) issue(label, 'number', '题号必须是唯一的正整数', '删除重复题号或重新编号')
    numbers.add(Number(number))
    if (item.id != null) {
      const id = String(item.id)
      if (!['string', 'number'].includes(typeof item.id) || !id.trim() || ids.has(id)) issue(label, 'id', 'ID 为空、类型不合法或重复', '为每题设置唯一的字符串 ID')
      ids.add(id)
    }
    let question: Question | undefined
    try {
      question = normalizeQuestionBank([item], name)[0]
      if (question) {
        result.questions.push(question)
        result.types[question.type] = (result.types[question.type] ?? 0) + 1
      }
    } catch (error) { issue(label, '结构', error instanceof Error ? error.message : String(error), '检查题型、题干、选项和子题字段') }
    function validateAnswer(value: Record<string, unknown>, type: string, field: string) {
      if (type === '综合题' || type === '综合应用题') return
      const answer = Array.isArray(value.answer) ? value.answer.map(String).join('') : String(value.answer ?? '').trim()
      // 缺答案在人工导入时是硬错误；AI 转换出的草稿允许先保存，由终端逐题提示后补
      if (!answer) {
        if (options.allowMissingAnswers) warn(labelWithContent(value, label), field + 'answer', '缺少有效答案', '补齐标准答案后再导入')
        else issue(label, field + 'answer', '缺少有效答案', '补齐标准答案后再导入')
      }
      if (value.answer != null && !['string', 'number', 'boolean'].includes(typeof value.answer) && !Array.isArray(value.answer)) issue(label, field + 'answer', '答案类型不合法', '使用字符串或多选答案数组')
      if (['单选题', '多选题'].includes(type)) {
        const options = value.options
        if (!record(options) || Object.keys(options).length < 2 || Object.entries(options).some(([key, text]) => !/^[A-Z]$/.test(key) || typeof text !== 'string' || !text.trim())) {
          issue(label, field + 'options', '选择题至少需要两个非空选项，键为 A-Z', '使用 {"A":"选项一","B":"选项二"} 格式')
        } else if (answer && ((type === '单选题' && answer.length !== 1) || !/^[A-Z]+$/.test(answer) || new Set(answer).size !== answer.length || [...answer].some(key => !(key in options)))) {
          issue(label, field + 'answer', '答案与选项不匹配', '单选填一个选项键，多选填不重复的选项键或数组')
        }
      }
      if (type === '判断题' && answer && !['A', 'B', 'T', 'F', 'TRUE', 'FALSE', '正确', '错误', '对', '错', 'YES', 'NO', '1', '0'].includes(answer.toUpperCase())) issue(label, field + 'answer', '判断题答案无法识别', '填写 A/B、true/false 或 正确/错误')
    }
    if (question) {
      validateAnswer(item, question.type, '')
      if (['综合题', '综合应用题'].includes(question.type) && (!Array.isArray(item.subQuestions) || !item.subQuestions.length)) issue(label, 'subQuestions', '复合题没有子题', '补齐非空的 subQuestions 数组')
      if (Array.isArray(item.subQuestions)) {
        const subIds = new Set<string>()
        item.subQuestions.forEach((sub, subIndex) => {
          if (!record(sub)) return
          const field = `subQuestions[${subIndex}].`
          const id = String(sub.id ?? subIndex + 1)
          if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || subIds.has(id)) issue(label, field + 'id', '子题 ID 必须为唯一正整数', '修正子题 ID')
          subIds.add(id)
          let type = '文本题'
          try { type = sub.type === '文本题' || sub.type == null ? '文本题' : normalizeQuestionType(sub.type) } catch { issue(label, field + 'type', '未知子题类型', '使用 single、multiple、fill 或 文本题') }
          if (!['文本题', '单选题', '多选题', '填空题'].includes(type)) issue(label, field + 'type', '当前不支持此子题类型', '改为文本题或支持的选择/填空子题')
          validateAnswer(sub, type, field)
        })
      }
    }
    const text = JSON.stringify(item)
    for (const match of text.matchAll(/(?:\/images\/[^\s"\\)\]<>]+|data:image\/[^"\s]+)/g)) imagePaths.add(match[0])
    if (Array.isArray(item.images)) for (const image of item.images) imagePaths.add(String(image))
  }
  result.imageCount = imagePaths.size
  return result
}

export function bankIssueReport(inspection: BankInspection): string {
  return [`文件：${inspection.name}`, ...inspection.issues.map(issue => `${issue.question} · ${issue.field}：${issue.reason}；建议：${issue.suggestion}`)].join('\n')
}

/** 不阻断保存的提示文本，例如 AI 转换出的题目暂时没有答案。 */
export function bankWarningReport(inspection: BankInspection): string {
  return inspection.warnings.map(item => `${item.question} · ${item.field}：${item.reason}`).join('\n')
}
