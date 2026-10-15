export const BANK_SOURCES_KEY = 'bankSources_v2'
export type BankSource = 'import' | 'ai' | 'legacy'

export function readBankSources(): Record<string, BankSource> {
  try {
    const value = JSON.parse(localStorage.getItem(BANK_SOURCES_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export function rememberBankSource(file: string, source: BankSource) {
  try { localStorage.setItem(BANK_SOURCES_KEY, JSON.stringify({ ...readBankSources(), [file]: source })) }
  catch (error) { console.warn('题库已保存，但来源标记保存失败：', error) }
}

export function forgetBankSources(files: string[]) {
  try {
    const sources = readBankSources()
    for (const file of files) delete sources[file]
    localStorage.setItem(BANK_SOURCES_KEY, JSON.stringify(sources))
  } catch (error) { console.warn('题库来源标记清理失败：', error) }
}

export function bankSourceLabel(file: string, development = false): string {
  const source = readBankSources()[file]
  if (source === 'import') return '文件导入'
  if (source === 'ai') return 'AI 转换'
  if (source === 'legacy') return '旧版迁移'
  if (file.startsWith('generated:')) return '应用内题库'
  if (file.startsWith('/user-subjects/')) return '用户目录 / 手动放入'
  return development ? '开发目录' : '只读资源'
}
