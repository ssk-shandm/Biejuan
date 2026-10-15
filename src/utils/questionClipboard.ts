import type { Question, SubQuestion } from '../types'

const judgmentOptions = { A: '正确', B: '错误' }

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

function appendOptions(lines: string[], options: Record<string, string>, type?: string) {
  const entries = Object.entries(options)
  const normalizedOptions = entries.length > 0 || type !== '判断题' ? entries : Object.entries(judgmentOptions)
  if (normalizedOptions.length === 0) return

  lines.push('选项：')
  for (const [key, value] of normalizedOptions) {
    lines.push(`${key}. ${cleanText(value)}`)
  }
}

function appendSubQuestion(lines: string[], subQuestion: SubQuestion) {
  const questionText = cleanText(subQuestion.question)
  lines.push(`第${subQuestion.id}小题：`)
  if (questionText) lines.push(questionText)
  appendOptions(lines, subQuestion.options, subQuestion.type)
}

export function formatQuestionForClipboard(question: Question): string {
  const lines = ['题目：']
  const questionText = cleanText(question.question)
  if (questionText) lines.push(questionText)

  const scenario = cleanText(question.scenario)
  if (scenario && scenario !== questionText) {
    lines.push('', '场景：', scenario)
  }

  const images = question.images.map((image) => cleanText(image)).filter(Boolean)
  if (images.length > 0) {
    lines.push('', '题目图片：')
    images.forEach((image, index) => lines.push(`${index + 1}. ${image}`))
  }

  appendOptions(lines, question.options, question.type)

  if (question.subQuestions?.length) {
    lines.push('', '小题：')
    question.subQuestions.forEach((subQuestion, index) => {
      if (index > 0) lines.push('')
      appendSubQuestion(lines, subQuestion)
    })
  }

  return lines.join('\n').trim()
}

export async function copyTextToClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return
    } catch {
    }
  }

  if (typeof document === 'undefined') throw new Error('当前环境不支持剪贴板')

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } finally {
    textarea.remove()
  }

  if (!copied) throw new Error('复制失败')
}
