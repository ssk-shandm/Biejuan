import katex from 'katex'
import type { TokenizerExtension, RendererExtension } from 'marked'

function renderFormula(source: string, displayMode: boolean): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20,
  })
}

export const mathExtensions: (TokenizerExtension & RendererExtension)[] = [
  {
    name: 'blockMath',
    level: 'block',
    start(source) { return source.search(/\$\$|\\\[/) },
    tokenizer(source) {
      const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\r?\n|$)/.exec(source)
      if (!match) return undefined
      return { type: 'blockMath', raw: match[0], formula: (match[1] ?? match[2] ?? '').trim() }
    },
    renderer(token) { return renderFormula(String(token.formula), true) },
  },
  {
    name: 'inlineMath',
    level: 'inline',
    start(source) { return source.search(/\$|\\\(|[\p{L}\d]+\^(?:\{[^{}\n]+\}|[+-]?\d+)/u) },
    tokenizer(source) {
      const match = /^(?:\$\$([^\n]+?)\$\$|\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)|\\\(([^\n]+?)\\\))/.exec(source)
      if (match) {
        return { type: 'inlineMath', raw: match[0], formula: match[1] ?? match[2] ?? match[3], displayMode: Boolean(match[1]) }
      }
      const power = /^[\p{L}\d]+\^(?:\{[^{}\n]+\}|[+-]?\d+)/u.exec(source)
      if (!power) return undefined
      return { type: 'inlineMath', raw: power[0], formula: power[0], displayMode: false }
    },
    renderer(token) { return renderFormula(String(token.formula), Boolean(token.displayMode)) },
  },
]
