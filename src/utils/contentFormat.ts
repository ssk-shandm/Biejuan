import type { ContentFormat } from '../types'

export function normalizeContentFormat(value: unknown, fallback: ContentFormat = 'text'): ContentFormat {
  const format = String(value ?? '').trim().toLowerCase()
  if (['text', 'txt', 'plain-text', 'plaintext'].includes(format)) return 'text'
  if (format === 'markdown' || format === 'md') return 'markdown'
  if (format === 'mermaid' || format === 'mmd') return 'mermaid'
  if (['plantuml', 'puml', 'uml'].includes(format)) return 'plantuml'
  return fallback
}

export function inheritedContentFormat(format: ContentFormat): ContentFormat {
  return format === 'mermaid' || format === 'plantuml' ? 'text' : normalizeContentFormat(format)
}
