import DOMPurify from 'dompurify'
import type { ContentFormat } from '../types'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import sql from 'highlight.js/lib/languages/sql'

hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('sql', sql)

marked.setOptions({ gfm: true, breaks: true })
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
      return hljs.highlightAuto(code).value
    },
  }),
)

export type DiagramType = 'mermaid' | 'plantuml'
export interface DiagramBlock {
  type: DiagramType
  source: string
}
export interface MarkdownDocument {
  html: string
  diagrams: DiagramBlock[]
}

const DIAGRAM_FENCE = /```\s*(mermaid|plantuml|puml)\s*\r?\n([\s\S]*?)```/gi

/**
 * Markdown 安全渲染入口。图表代码先被抽离，普通 HTML 经 DOMPurify 清洗，
 * Mermaid/PlantUML 再由 MarkdownContent 在隔离容器中渲染。
 */
export function renderMarkdownDocument(content: string, format: ContentFormat = 'markdown'): MarkdownDocument {
  if (format === 'mermaid' || format === 'plantuml') {
    const source = String(content ?? '').trim()
    const fenced = source.match(/^```(?:mermaid|plantuml|puml)\s*\r?\n([\s\S]*?)\r?\n```\s*$/i)
    return {
      html: source ? '<div class="diagram-placeholder" data-diagram-index="0" role="img" aria-label="diagram"></div>' : '',
      diagrams: source ? [{ type: format, source: (fenced?.[1] ?? source).trim() }] : [],
    }
  }
  const diagrams: DiagramBlock[] = []
  const source = String(content ?? '').replace(DIAGRAM_FENCE, (_match, language: string, code: string) => {
    const index = diagrams.length
    diagrams.push({
      type: language.toLowerCase() === 'mermaid' ? 'mermaid' : 'plantuml',
      source: code.trim(),
    })
    return `\n<div class="diagram-placeholder" data-diagram-index="${index}" role="img" aria-label="${language} diagram"><span>正在渲染图表…</span></div>\n`
  })

  try {
    const html = marked.parse(source) as string
    return {
      html: DOMPurify.sanitize(html, {
        ADD_ATTR: ['data-diagram-index', 'role', 'aria-label', 'target', 'rel'],
      }),
      diagrams,
    }
  } catch (error) {
    console.error('Markdown 渲染失败:', error)
    return { html: escapeHtml(source), diagrams }
  }
}


/** 去除 Markdown 标记，用于答案比对。 */
export function stripMarkdown(text: string): string {
  if (text == null) return ''
  let result = text
  result = result.replace(/```[\s\S]*?```/g, '')
  result = result.replace(/`([^`]+)`/g, '$1')
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
  result = result.replace(/\*([^*]+)\*/g, '$1')
  result = result.replace(/^#{1,6}\s+/gm, '')
  result = result.replace(/<[^>]+>/g, '')
  return result.trim()
}

export function escapeHtml(text: string): string {
  if (text == null || text === '') return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
