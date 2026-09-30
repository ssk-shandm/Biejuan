type PdfTextItem = { str?: string; hasEOL?: boolean; transform?: number[]; height?: number }

/**
 * 把 PDF.js 的 textContent.items 还原为按行分隔的文本。
 * 优先使用 hasEOL；没有换行标记时，根据基线 y 坐标的跳变判断换行，
 * 避免整页文字被拼成一行导致题目边界丢失。
 */
export function pdfItemsToText(items: unknown[]) {
  const lines: string[] = []
  let current = ''
  let lastY: number | undefined
  for (const raw of items) {
    const item = raw as PdfTextItem
    if (typeof item.str !== 'string') continue
    const y = item.transform?.[5]
    const lineHeight = Math.max(2, (item.height ?? 10) * 0.5)
    if (current && lastY !== undefined && y !== undefined && Math.abs(y - lastY) > lineHeight) {
      lines.push(current)
      current = ''
    }
    current += item.str
    if (y !== undefined && item.str.trim()) lastY = y
    if (item.hasEOL) {
      lines.push(current)
      current = ''
    }
  }
  if (current) lines.push(current)
  return lines.map((line) => line.replace(/\s+$/, '')).filter((line) => line.trim()).join('\n')
}
