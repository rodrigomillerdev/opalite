import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { escapeXml } from './xml'

/*
 * Documento de texto: HTML do editor <-> .docx.
 *
 * Gravação: o HTML vira parágrafos, títulos, listas, tabelas e imagens do
 * Word (biblioteca docx). Uma cópia do HTML vai junto numa parte "customXml"
 * (mecanismo padrão do formato, preservado pelo Word), com uma impressão
 * digital do conteúdo. Ao reabrir no Opalite, se o documento não foi editado
 * em outro programa, o editor recebe exatamente o que a pessoa escreveu.
 */

const NS = 'urn:opalite:document:1'

interface Fmt {
  bold?: boolean
  italics?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  highlight?: string
  size?: number
  font?: string
  sup?: boolean
  sub?: boolean
}

const PX_PER_PT = 4 / 3

function cssColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.slice(1).toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return v.slice(1).split('').map((c) => c + c).join('').toUpperCase()
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(v)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined
    return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  return undefined
}

function sizePt(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const m = /^([\d.]+)(px|pt|em|rem)?$/.exec(value.trim())
  if (!m) return undefined
  const n = Number(m[1])
  if (m[2] === 'pt') return n
  if (m[2] === 'em' || m[2] === 'rem') return n * 11
  return n / PX_PER_PT
}

function fmtOf(el: HTMLElement, base: Fmt): Fmt {
  const f: Fmt = { ...base }
  const tag = el.tagName
  if (tag === 'B' || tag === 'STRONG') f.bold = true
  if (tag === 'I' || tag === 'EM') f.italics = true
  if (tag === 'U') f.underline = true
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.strike = true
  if (tag === 'SUP') f.sup = true
  if (tag === 'SUB') f.sub = true
  if (tag === 'MARK') f.highlight = 'FFF59D'
  if (tag === 'CODE') f.font = 'Consolas'
  const s = el.style
  if (s.fontWeight === 'bold' || Number(s.fontWeight) >= 600) f.bold = true
  if (s.fontStyle === 'italic') f.italics = true
  if (s.textDecorationLine?.includes('underline') || s.textDecoration?.includes('underline')) f.underline = true
  if (s.textDecorationLine?.includes('line-through') || s.textDecoration?.includes('line-through')) f.strike = true
  const color = cssColor(s.color)
  if (color) f.color = color
  const bg = cssColor(s.backgroundColor)
  if (bg) f.highlight = bg
  const size = sizePt(s.fontSize)
  if (size) f.size = size
  if (s.fontFamily) f.font = s.fontFamily.split(',')[0]!.replace(/["']/g, '').trim()
  if (tag === 'FONT') {
    const c = cssColor(el.getAttribute('color'))
    if (c) f.color = c
    const face = el.getAttribute('face')
    if (face) f.font = face
  }
  return f
}

function runOptions(text: string, f: Fmt): IRunOptions {
  return {
    text,
    ...(f.bold ? { bold: true } : {}),
    ...(f.italics ? { italics: true } : {}),
    ...(f.underline ? { underline: {} } : {}),
    ...(f.strike ? { strike: true } : {}),
    ...(f.color ? { color: f.color } : {}),
    ...(f.highlight ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: f.highlight } } : {}),
    ...(f.size ? { size: Math.round(f.size * 2) } : {}),
    ...(f.font ? { font: f.font } : {}),
    ...(f.sup ? { superScript: true } : {}),
    ...(f.sub ? { subScript: true } : {}),
  }
}

/** Bytes de uma imagem data: URL (convertendo formatos que o Word não aceita para PNG). */
async function imageData(img: HTMLImageElement): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> {
  const src = img.getAttribute('src') ?? ''
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i.exec(src)
  if (m) {
    const bin = atob(m[2]!)
    const data = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
    const t = m[1]!.toLowerCase()
    return { data, type: t === 'jpeg' || t === 'jpg' ? 'jpg' : (t as 'png' | 'gif' | 'bmp') }
  }
  // webp, svg, blob: -> PNG via canvas
  try {
    await img.decode().catch(() => {})
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width || 1
    canvas.height = img.naturalHeight || img.height || 1
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) return null
    return { data: new Uint8Array(await blob.arrayBuffer()), type: 'png' }
  } catch {
    return null
  }
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  start: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  end: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
}

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'SECTION'])

/** Largura útil da página A4 com margens de 2,5 cm, em px. */
const CONTENT_PX = 604

async function inlineChildren(node: Node, base: Fmt, out: ParagraphChild[]): Promise<void> {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ')
      if (text) out.push(new TextRun(runOptions(text, base)))
      continue
    }
    if (!(child instanceof HTMLElement)) continue
    if (child.tagName === 'BR') {
      out.push(new TextRun({ break: 1 }))
      continue
    }
    if (child.tagName === 'IMG') {
      const img = child as HTMLImageElement
      const data = await imageData(img)
      if (data) {
        const w = Number(img.getAttribute('width')) || img.width || img.naturalWidth || 300
        const h = Number(img.getAttribute('height')) || img.height || img.naturalHeight || 200
        const scale = Math.min(1, CONTENT_PX / w)
        out.push(new ImageRun({ type: data.type, data: data.data, transformation: { width: Math.round(w * scale), height: Math.round(h * scale) } }))
      }
      continue
    }
    if (child.dataset['pageBreak'] !== undefined) {
      out.push(new PageBreak())
      continue
    }
    if (child.tagName === 'A' && /^https?:|^mailto:/i.test(child.getAttribute('href') ?? '')) {
      const runs: ParagraphChild[] = []
      await inlineChildren(child, { ...fmtOf(child, base), color: base.color ?? '3D4FC4', underline: true }, runs)
      out.push(new ExternalHyperlink({ link: child.getAttribute('href')!, children: runs as TextRun[] }))
      continue
    }
    await inlineChildren(child, fmtOf(child, base), out)
  }
}

type Block = Paragraph | Table

async function blocks(container: Node, ctx: { list?: { ordered: boolean; level: number } }, out: Block[]): Promise<void> {
  let inline: Node[] = []
  const flushInline = async () => {
    if (!inline.length) return
    const holder = document.createElement('p')
    for (const n of inline) holder.appendChild(n.cloneNode(true))
    inline = []
    if (holder.textContent?.trim() || holder.querySelector('img')) out.push(await paragraph(holder, {}))
  }

  for (const node of [...container.childNodes]) {
    if (!(node instanceof HTMLElement) || !BLOCK.has(node.tagName)) {
      inline.push(node)
      continue
    }
    await flushInline()
    const tag = node.tagName
    if (tag === 'UL' || tag === 'OL') {
      const level = ctx.list ? ctx.list.level + 1 : 0
      for (const li of [...node.children]) {
        if (li.tagName !== 'LI') continue
        // Texto do item (sem as sublistas) e depois as sublistas.
        const own = document.createElement('p')
        for (const c of [...li.childNodes]) if (!(c instanceof HTMLElement && (c.tagName === 'UL' || c.tagName === 'OL'))) own.appendChild(c.cloneNode(true))
        own.setAttribute('style', (li as HTMLElement).getAttribute('style') ?? '')
        out.push(await paragraph(own, { numbering: { reference: tag === 'OL' ? 'opal-numbers' : 'opal-bullets', level: Math.min(level, 8) } }))
        for (const sub of [...li.children]) if (sub.tagName === 'UL' || sub.tagName === 'OL') await blocks(wrap(sub), { list: { ordered: sub.tagName === 'OL', level } }, out)
      }
    } else if (tag === 'TABLE') {
      out.push(await table(node as HTMLTableElement))
    } else if (tag === 'HR') {
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } } }))
    } else if (tag === 'PRE') {
      for (const line of (node.textContent ?? '').split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })], spacing: { after: 0 } }))
    } else if (tag === 'BLOCKQUOTE') {
      const inner: Block[] = []
      await blocks(node, ctx, inner)
      for (const b of inner) out.push(b instanceof Paragraph ? b : b)
    } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'FIGURE') {
      if (node.dataset['pageBreak'] !== undefined) out.push(new Paragraph({ children: [new PageBreak()] }))
      else if ([...node.children].some((c) => BLOCK.has(c.tagName))) await blocks(node, ctx, out)
      else out.push(await paragraph(node, {}))
    } else {
      out.push(await paragraph(node, HEADINGS[tag] ? { heading: HEADINGS[tag] } : {}))
    }
  }
  await flushInline()
}

function wrap(el: Element): HTMLElement {
  const d = document.createElement('div')
  d.appendChild(el.cloneNode(true))
  return d
}

async function paragraph(el: HTMLElement, extra: Partial<IParagraphOptions>): Promise<Paragraph> {
  const children: ParagraphChild[] = []
  await inlineChildren(el, fmtOf(el, {}), children)
  const align = ALIGN[el.style.textAlign]
  const indent = parseFloat(el.style.marginLeft || el.style.paddingLeft || '0')
  const quote = el.closest('blockquote') !== null
  return new Paragraph({
    children,
    ...(align ? { alignment: align } : {}),
    ...(indent > 0 || quote ? { indent: { left: Math.round((indent || 36) * 15) } } : {}),
    ...extra,
  })
}

async function table(el: HTMLTableElement): Promise<Table> {
  const rows: TableRow[] = []
  const first = el.rows[0]
  const cols = first ? [...first.cells].reduce((n, c) => n + (c.colSpan || 1), 0) : 1
  for (const tr of [...el.rows]) {
    const cells: TableCell[] = []
    for (const td of [...tr.cells]) {
      const inner: Block[] = []
      await blocks(td, {}, inner)
      const bg = cssColor(td.style.backgroundColor)
      cells.push(
        new TableCell({
          children: inner.length ? inner : [new Paragraph('')],
          ...(td.colSpan > 1 ? { columnSpan: td.colSpan } : {}),
          ...(bg ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg } } : {}),
          width: { size: Math.round(100 / cols) * (td.colSpan || 1), type: WidthType.PERCENTAGE },
        }),
      )
    }
    rows.push(new TableRow({ children: cells, tableHeader: tr.parentElement?.tagName === 'THEAD' }))
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

/** Impressão digital simples do conteúdo (detecta edição em outro programa). */
function fingerprint(bytes: Uint8Array): string {
  let h = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export async function htmlToDocx(html: string, options: { title?: string } = {}): Promise<Uint8Array> {
  const host = document.createElement('div')
  host.innerHTML = html
  const body: Block[] = []
  await blocks(host, {}, body)
  if (!body.length) body.push(new Paragraph(''))

  const bulletLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: ['•', '◦', '▪'][level % 3]!,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }))
  const numberLevels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3]!,
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }))

  const doc = new Document({
    creator: 'Opalite',
    title: options.title ?? '',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
    },
    numbering: {
      config: [
        { reference: 'opal-bullets', levels: bulletLevels },
        { reference: 'opal-numbers', levels: numberLevels },
      ],
    },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1417, bottom: 1417, left: 1417, right: 1417 } } }, children: body }],
  })
  const bytes = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
  return embedSource(bytes, html)
}

/** Acrescenta o HTML do editor como customXml (com a impressão digital do document.xml). */
function embedSource(docx: Uint8Array, html: string): Uint8Array {
  const files = unzipSync(docx)
  const docXml = files['word/document.xml']
  if (!docXml) return docx
  const item = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<opalite xmlns="${NS}" fingerprint="${fingerprint(docXml)}"><html>${escapeXml(html)}</html></opalite>`
  files['customXml/item1.xml'] = strToU8(item)
  files['customXml/itemProps1.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ds:datastoreItem ds:itemID="{6F1A0C3E-0B5E-4C0E-9C55-0A11A7E00001}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${NS}"/></ds:schemaRefs></ds:datastoreItem>`,
  )
  files['customXml/_rels/item1.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>',
  )
  const rels = strFromU8(files['word/_rels/document.xml.rels']!)
  if (!rels.includes('customXml/item1.xml')) {
    files['word/_rels/document.xml.rels'] = strToU8(
      rels.replace('</Relationships>', '<Relationship Id="rIdOpaliteSrc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'),
    )
  }
  const types = strFromU8(files['[Content_Types].xml']!)
  if (!types.includes('itemProps1.xml')) {
    files['[Content_Types].xml'] = strToU8(
      types.replace('</Types>', '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'),
    )
  }
  return zipSync(files, { level: 6 })
}

/**
 * HTML gravado pelo Opalite dentro do .docx, se o documento não foi
 * alterado por outro programa desde então. null = usar a conversão comum.
 */
export function embeddedSource(docx: Uint8Array): string | null {
  try {
    const files = unzipSync(docx, { filter: (f) => f.name === 'word/document.xml' || f.name.startsWith('customXml/item') })
    const docXml = files['word/document.xml']
    for (const [name, data] of Object.entries(files)) {
      if (!/^customXml\/item\d+\.xml$/.test(name)) continue
      const xml = strFromU8(data)
      if (!xml.includes(NS)) continue
      const fp = /fingerprint="([0-9a-f]+)"/.exec(xml)?.[1]
      if (!docXml || fp !== fingerprint(docXml)) return null
      const m = /<html>([\s\S]*)<\/html>/.exec(xml)
      if (!m) return null
      const t = document.createElement('textarea')
      t.innerHTML = m[1]!
      return t.value
    }
  } catch {
    // zip ilegível: cai na conversão comum (que mostrará o erro)
  }
  return null
}
