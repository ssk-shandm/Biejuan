export type DocumentImageAsset = {
  id: string
  fileName: string
  blob: Blob
  sourceFile: string
  sourceIndex: number
  nearbyText: string
}

export type ExtractedDocument = {
  text: string
  images: DocumentImageAsset[]
}

type ImageReference = {
  target: string
  assetId: string
  sourceIndex: number
  nearbyText: string
}

type NumberingLevel = { format: string; text: string; start: number }
type NumberingInstance = { abstractId: string; levels: Map<number, NumberingLevel>; startOverrides: Map<number, number> }
type NumberingContext = {
  instances: Map<string, NumberingInstance>
  styleNumbering: Map<string, { numId?: string; ilvl?: number }>
  counters: Map<string, Array<number | undefined>>
  startedInstances: Set<string>
}

type JSZipInstance = InstanceType<typeof import('jszip')>

const IMAGE_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function localNameOf(node: Node) {
  return (node as Element).localName ?? node.nodeName.split(':').pop() ?? ''
}

function childElements(node: Node, localName?: string) {
  return Array.from(node.childNodes ?? []).filter((child): child is Element =>
    child.nodeType === 1 && (!localName || localNameOf(child) === localName),
  )
}

function firstChild(node: Node | undefined, localName: string) {
  return node ? childElements(node, localName)[0] : undefined
}

function wAttr(element: Element | undefined, name: string) {
  return element?.getAttribute(`w:${name}`) ?? undefined
}

function relationshipAttr(element: Element, name: 'embed' | 'id') {
  return element.getAttribute(`r:${name}`) || element.getAttributeNS(RELATIONSHIP_NS, name) || ''
}

function assertValidXml(document: XMLDocument, label: string) {
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error(`${label} 解析失败。`)
}

async function readZipXml(zip: JSZipInstance, path: string, parser: DOMParser, required?: true): Promise<XMLDocument>
async function readZipXml(zip: JSZipInstance, path: string, parser: DOMParser, required: false): Promise<XMLDocument | undefined>
async function readZipXml(zip: JSZipInstance, path: string, parser: DOMParser, required = true) {
  const entry = zip.file(path)
  if (!entry) {
    if (required) throw new Error(`文档缺少 ${path}。`)
    return undefined
  }
  const document = parser.parseFromString(await entry.async('text'), 'application/xml')
  assertValidXml(document, path)
  return document
}

/** 把关系文件中的 Target 解析为 zip 内的绝对路径。 */
function resolveZipPath(fromFile: string, target: string) {
  if (target.startsWith('/')) return target.slice(1)
  const stack = fromFile.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

function readRelationships(document: XMLDocument | undefined, ownerFile: string, type?: string) {
  const targets = new Map<string, string>()
  if (!document) return targets
  for (const relation of Array.from(document.getElementsByTagName('Relationship'))) {
    const id = relation.getAttribute('Id')
    const target = relation.getAttribute('Target')
    if (!id || !target || relation.getAttribute('TargetMode') === 'External') continue
    if (type && relation.getAttribute('Type') !== type) continue
    targets.set(id, resolveZipPath(ownerFile, target))
  }
  return targets
}

function getExtension(path: string, mimeType: string) {
  return path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || mimeType.split('/')[1]?.split('+')[0] || 'bin'
}

/** 分配图片 id，并在文本中插入 <source_image/> 锚点，供模型把图片挂到对应题目。 */
function createImageRegistry(imageOffset: number) {
  const references: ImageReference[] = []
  const assetIdsByTarget = new Map<string, string>()
  let assetIndex = 0
  return {
    references,
    register(target: string, nearbyText: string) {
      let assetId = assetIdsByTarget.get(target)
      if (!assetId) {
        assetIndex += 1
        assetId = `img-${String(imageOffset + assetIndex).padStart(3, '0')}`
        assetIdsByTarget.set(target, assetId)
      }
      references.push({ target, assetId, sourceIndex: imageOffset + references.length + 1, nearbyText })
      return `\n<source_image id="${assetId}"/>\n`
    },
  }
}

async function collectImageAssets(zip: JSZipInstance, references: ImageReference[], sourceFile: string) {
  const assets: DocumentImageAsset[] = []
  const seen = new Set<string>()
  for (const reference of references) {
    if (seen.has(reference.target)) continue
    seen.add(reference.target)
    const entry = zip.file(reference.target)
    if (!entry) continue
    const blob = await entry.async('blob')
    const ordinal = reference.assetId.match(/img-(\d+)$/)?.[1] ?? String(assets.length + 1).padStart(3, '0')
    assets.push({
      id: reference.assetId,
      fileName: `img-${ordinal}.${getExtension(reference.target, blob.type)}`,
      blob,
      sourceFile,
      sourceIndex: reference.sourceIndex,
      nearbyText: (reference.nearbyText || '题目配图').slice(0, 120),
    })
  }
  return assets
}

function normalizeBlockText(text: string) {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Word 自动编号 ──
// 很多题库的题号、选项字母来自 Word 自动编号，不在 w:t 文本里。
// 不还原编号，模型就看不到“1.”“A.”这类题目边界。

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

function toChineseNumber(value: number): string {
  if (value < 10) return CHINESE_DIGITS[value]!
  if (value < 20) return `十${value % 10 ? CHINESE_DIGITS[value % 10] : ''}`
  if (value < 100) return `${CHINESE_DIGITS[Math.floor(value / 10)]}十${value % 10 ? CHINESE_DIGITS[value % 10] : ''}`
  return String(value)
}

function toLetters(value: number) {
  let result = ''
  let remaining = value
  while (remaining > 0) {
    remaining -= 1
    result = String.fromCharCode(65 + (remaining % 26)) + result
    remaining = Math.floor(remaining / 26)
  }
  return result || 'A'
}

function toRoman(value: number) {
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let remaining = value
  let result = ''
  for (const [amount, symbol] of table) {
    while (remaining >= amount) {
      result += symbol
      remaining -= amount
    }
  }
  return result
}

function formatListNumber(value: number, format: string) {
  switch (format) {
    case 'upperLetter': return toLetters(value)
    case 'lowerLetter': return toLetters(value).toLowerCase()
    case 'upperRoman': return toRoman(value)
    case 'lowerRoman': return toRoman(value).toLowerCase()
    case 'decimalZero': return String(value).padStart(2, '0')
    case 'decimalFullWidth':
    case 'decimalFullWidth2': return String(value).replace(/\d/g, (digit) => String.fromCharCode(0xff10 + Number(digit)))
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese': return value >= 1 && value <= 20 ? String.fromCharCode(0x245f + value) : String(value)
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'chineseLegalSimplified':
    case 'ideographTraditional':
    case 'japaneseCounting': return toChineseNumber(value)
    default: return String(value)
  }
}

function parseNumberingLevels(parent: Element) {
  const levels = new Map<number, NumberingLevel>()
  for (const level of childElements(parent, 'lvl')) {
    const ilvl = Number(wAttr(level, 'ilvl') ?? 0)
    levels.set(ilvl, {
      format: wAttr(firstChild(level, 'numFmt'), 'val') ?? 'decimal',
      text: wAttr(firstChild(level, 'lvlText'), 'val') ?? '',
      start: Number(wAttr(firstChild(level, 'start'), 'val') ?? 1),
    })
  }
  return levels
}

function parseNumbering(numberingXml: XMLDocument | undefined, stylesXml: XMLDocument | undefined): NumberingContext {
  const abstracts = new Map<string, Map<number, NumberingLevel>>()
  const instances = new Map<string, NumberingInstance>()
  if (numberingXml) {
    for (const abstract of Array.from(numberingXml.getElementsByTagName('w:abstractNum'))) {
      const id = wAttr(abstract, 'abstractNumId')
      if (id) abstracts.set(id, parseNumberingLevels(abstract))
    }
    for (const num of Array.from(numberingXml.getElementsByTagName('w:num'))) {
      const numId = wAttr(num, 'numId')
      const abstractId = wAttr(firstChild(num, 'abstractNumId'), 'val')
      if (!numId || !abstractId) continue
      const levels = new Map(abstracts.get(abstractId) ?? [])
      const startOverrides = new Map<number, number>()
      for (const override of childElements(num, 'lvlOverride')) {
        const ilvl = Number(wAttr(override, 'ilvl') ?? 0)
        const start = wAttr(firstChild(override, 'startOverride'), 'val')
        if (start != null) startOverrides.set(ilvl, Number(start))
        const overrideLevel = parseNumberingLevels(override).get(ilvl)
        if (overrideLevel) levels.set(ilvl, overrideLevel)
      }
      instances.set(numId, { abstractId, levels, startOverrides })
    }
  }

  const styleNumbering = new Map<string, { numId?: string; ilvl?: number }>()
  if (stylesXml) {
    for (const style of Array.from(stylesXml.getElementsByTagName('w:style'))) {
      const styleId = wAttr(style, 'styleId')
      const numPr = firstChild(firstChild(style, 'pPr'), 'numPr')
      if (!styleId || !numPr) continue
      const ilvl = wAttr(firstChild(numPr, 'ilvl'), 'val')
      styleNumbering.set(styleId, { numId: wAttr(firstChild(numPr, 'numId'), 'val'), ilvl: ilvl == null ? undefined : Number(ilvl) })
    }
  }
  return { instances, styleNumbering, counters: new Map(), startedInstances: new Set() }
}

function paragraphNumberPrefix(paragraph: Element, context: NumberingContext) {
  const pPr = firstChild(paragraph, 'pPr')
  const numPr = firstChild(pPr, 'numPr')
  const style = context.styleNumbering.get(wAttr(firstChild(pPr, 'pStyle'), 'val') ?? '')
  const numId = wAttr(firstChild(numPr, 'numId'), 'val') ?? style?.numId
  const ilvlText = wAttr(firstChild(numPr, 'ilvl'), 'val')
  const ilvl = ilvlText != null ? Number(ilvlText) : style?.ilvl ?? 0
  if (!numId || numId === '0') return ''
  const instance = context.instances.get(numId)
  const level = instance?.levels.get(ilvl)
  if (!instance || !level) return ''

  const counters = context.counters.get(instance.abstractId) ?? []
  if (!context.startedInstances.has(numId)) {
    context.startedInstances.add(numId)
    for (const [overrideLevel, start] of instance.startOverrides) {
      counters[overrideLevel] = start - 1
      counters.length = Math.max(counters.length, overrideLevel + 1)
    }
  }
  counters[ilvl] = (counters[ilvl] ?? level.start - 1) + 1
  for (let deeper = ilvl + 1; deeper < counters.length; deeper += 1) counters[deeper] = undefined
  context.counters.set(instance.abstractId, counters)

  if (level.format === 'none') return ''
  if (level.format === 'bullet') return '• '
  const text = level.text.replace(/%(\d)/g, (_, digit: string) => {
    const index = Number(digit) - 1
    const current = counters[index] ?? instance.levels.get(index)?.start ?? 1
    return formatListNumber(current, instance.levels.get(index)?.format ?? 'decimal')
  })
  return text ? `${text} ` : ''
}

/** Extract DOCX text and embedded images while preserving image positions, list numbering and tables. */
export async function extractDocxDocument(file: File, imageOffset = 0): Promise<ExtractedDocument> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()
  const document = await readZipXml(zip, 'word/document.xml', parser)
  const relationshipsXml = await readZipXml(zip, 'word/_rels/document.xml.rels', parser, false)
  const numbering = parseNumbering(
    await readZipXml(zip, 'word/numbering.xml', parser, false),
    await readZipXml(zip, 'word/styles.xml', parser, false),
  )
  const imageTargets = readRelationships(relationshipsXml, 'word/document.xml', IMAGE_RELATIONSHIP_TYPE)
  const images = createImageRegistry(imageOffset)
  const lines: string[] = []
  let lastParagraphText = ''

  const paragraphText = (paragraph: Element) => {
    let text = paragraphNumberPrefix(paragraph, numbering)
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes ?? [])) {
        const localName = localNameOf(child)
        if (localName === 't') text += child.textContent ?? ''
        else if (localName === 'tab') text += '\t'
        else if (localName === 'br' || localName === 'cr') text += '\n'
        else if (localName === 'Fallback' || localName === 'pPr' || localName === 'rPr') continue
        else if (localName === 'blip' || localName === 'imagedata') {
          const element = child as Element
          const target = imageTargets.get(relationshipAttr(element, localName === 'blip' ? 'embed' : 'id'))
          if (target) text += images.register(target, text.trim() || lastParagraphText)
        } else walk(child)
      }
    }
    walk(paragraph)
    return normalizeBlockText(text)
  }

  const blockLines = (node: Node): string[] => {
    const output: string[] = []
    for (const child of childElements(node)) {
      const localName = localNameOf(child)
      if (localName === 'p') {
        const text = paragraphText(child)
        if (!text) continue
        output.push(text)
        lastParagraphText = text.replace(/<source_image[^>]*\/>/g, '').trim()
      } else if (localName === 'tbl') {
        for (const row of childElements(child, 'tr')) {
          const cells = childElements(row, 'tc').map((cell) => blockLines(cell).join(' ').trim())
          if (cells.some(Boolean)) output.push(cells.join(' | '))
        }
      } else if (['sdt', 'sdtContent', 'customXml', 'ins', 'smartTag'].includes(localName)) {
        output.push(...blockLines(child))
      }
    }
    return output
  }

  const body = document.getElementsByTagName('w:body')[0]
  if (!body) throw new Error('DOCX 缺少正文。')
  lines.push(...blockLines(body))
  return { text: lines.join('\n'), images: await collectImageAssets(zip, images.references, file.name) }
}

/** Extract PPTX slide text (in slide order), tables and pictures. */
export async function extractPptxDocument(file: File, imageOffset = 0): Promise<ExtractedDocument> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()
  const presentation = await readZipXml(zip, 'ppt/presentation.xml', parser)
  const presentationRels = readRelationships(await readZipXml(zip, 'ppt/_rels/presentation.xml.rels', parser), 'ppt/presentation.xml')
  const slidePaths = Array.from(presentation.getElementsByTagName('p:sldId'))
    .map((slide) => presentationRels.get(relationshipAttr(slide, 'id')))
    .filter((path): path is string => Boolean(path && zip.file(path)))
  const images = createImageRegistry(imageOffset)
  const sections: string[] = []

  for (const [index, slidePath] of slidePaths.entries()) {
    const slide = await readZipXml(zip, slidePath, parser)
    const relsPath = slidePath.replace(/([^/]+)$/, '_rels/$1.rels')
    const imageTargets = readRelationships(await readZipXml(zip, relsPath, parser, false), slidePath, IMAGE_RELATIONSHIP_TYPE)
    const lines: string[] = []

    const paragraphText = (paragraph: Element) => {
      let text = ''
      const walk = (node: Node) => {
        for (const child of childElements(node)) {
          const localName = localNameOf(child)
          if (localName === 't') text += child.textContent ?? ''
          else if (localName === 'br') text += '\n'
          else if (localName !== 'pPr' && localName !== 'rPr') walk(child)
        }
      }
      walk(paragraph)
      return normalizeBlockText(text)
    }

    const walkShapes = (node: Node) => {
      for (const child of childElements(node)) {
        const localName = localNameOf(child)
        if (localName === 'Fallback') continue
        if (localName === 'p') {
          const text = paragraphText(child)
          if (text) lines.push(text)
        } else if (localName === 'tbl') {
          for (const row of childElements(child, 'tr')) {
            const cells = childElements(row, 'tc').map((cell) =>
              Array.from(cell.getElementsByTagName('a:p')).map(paragraphText).filter(Boolean).join(' '),
            )
            if (cells.some(Boolean)) lines.push(cells.join(' | '))
          }
        } else if (localName === 'blip') {
          const target = imageTargets.get(relationshipAttr(child, 'embed'))
          if (target) lines.push(images.register(target, lines.at(-1) ?? '').trim())
        } else walkShapes(child)
      }
    }

    walkShapes(slide.documentElement)
    sections.push([`--- 幻灯片 ${index + 1} ---`, ...lines].join('\n'))
  }

  return { text: sections.join('\n\n'), images: await collectImageAssets(zip, images.references, file.name) }
}
