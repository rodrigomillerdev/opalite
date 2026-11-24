import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { colIndex, colName, toFileFormula } from './formula'
import { type Cell, type CellStyle, type NumFmt, type Sheet, type Workbook, Calc, key, newSheet, shiftFormula } from './workbook'
import { type XmlNode, child, children, escapeXml as x, find, parseXml, textOf } from './xml'

/*
 * Leitura e gravação de .xlsx (Office Open XML / SpreadsheetML) feitas aqui
 * mesmo, sem biblioteca externa. Cobre valores, fórmulas, várias abas,
 * largura de colunas, altura de linhas e o estilo básico das células
 * (negrito, itálico, sublinhado, cores, alinhamento e formatos de número).
 * Gráficos, tabelas dinâmicas e macros não são lidos.
 */

// ------------------------------------------------------------ leitura

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function fmtFromCode(id: number, code: string | undefined): NumFmt | undefined {
  if (id === 0) return undefined
  if (id === 9 || id === 10) return 'percent'
  if (BUILTIN_DATE.has(id)) return 'date'
  if (id === 1 || id === 3) return 'integer'
  if (id === 2 || id === 4) return 'number'
  if (id >= 5 && id <= 8) return 'currency'
  if (!code) return undefined
  const c = code.replace(/"[^"]*"/g, (q) => (q.includes('$') ? '$' : ''))
  if (/[$€£]|R\$/.test(code)) return 'currency'
  if (c.includes('%')) return 'percent'
  if (/[dmy]/i.test(c) && !/0/.test(c)) return 'date'
  if (/0[.,]0/.test(c)) return 'number'
  if (/^#?,?#*0$/.test(c.trim()) || /#,##0$/.test(c.trim())) return 'integer'
  return undefined
}

function rgbOf(node: XmlNode | undefined): string | undefined {
  const rgb = node?.attrs['rgb']
  if (!rgb || rgb.length < 6) return undefined
  const hex = rgb.slice(-6).toLowerCase()
  return `#${hex}`
}

function readStyles(xml: string | undefined): CellStyle[] {
  if (!xml) return []
  const doc = parseXml(xml)
  const codes = new Map<number, string>()
  for (const nf of children(find(doc, 'numFmts'), 'numFmt')) codes.set(Number(nf.attrs['numFmtId']), nf.attrs['formatCode'] ?? '')
  const fonts = children(find(doc, 'fonts'), 'font').map((f) => ({
    b: Boolean(child(f, 'b')) && child(f, 'b')!.attrs['val'] !== '0',
    i: Boolean(child(f, 'i')) && child(f, 'i')!.attrs['val'] !== '0',
    u: Boolean(child(f, 'u')) && child(f, 'u')!.attrs['val'] !== 'none',
    s: Boolean(child(f, 'strike')) && child(f, 'strike')!.attrs['val'] !== '0',
    color: rgbOf(child(f, 'color')),
    size: child(f, 'sz') ? Number(child(f, 'sz')!.attrs['val']) : undefined,
  }))
  const fills = children(find(doc, 'fills'), 'fill').map((f) => {
    const p = child(f, 'patternFill')
    return p && p.attrs['patternType'] === 'solid' ? rgbOf(child(p, 'fgColor')) : undefined
  })
  return children(find(doc, 'cellXfs'), 'xf').map((xf) => {
    const font = fonts[Number(xf.attrs['fontId'] ?? 0)]
    const fill = fills[Number(xf.attrs['fillId'] ?? 0)]
    const numId = Number(xf.attrs['numFmtId'] ?? 0)
    const al = child(xf, 'alignment')
    const style: CellStyle = {}
    if (font?.b) style.b = true
    if (font?.i) style.i = true
    if (font?.u) style.u = true
    if (font?.s) style.s = true
    if (font?.color && font.color !== '#000000') style.color = font.color
    if (font?.size && font.size !== 11) style.size = font.size
    if (fill) style.fill = fill
    const fmt = fmtFromCode(numId, codes.get(numId))
    if (fmt) style.fmt = fmt
    const h = al?.attrs['horizontal']
    if (h === 'left' || h === 'center' || h === 'right') style.align = h
    if (al?.attrs['wrapText'] === '1') style.wrap = true
    return style
  })
}

function splitRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!
  return { col: colIndex(m[1]!), row: Number(m[2]) - 1 }
}

const resolvePath = (base: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

export function readXlsx(bytes: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('Arquivo .xlsx inválido ou corrompido.')
  }
  const text = (p: string) => (files[p] ? strFromU8(files[p]!) : undefined)
  const wbXml = text('xl/workbook.xml')
  if (!wbXml) throw new Error('Este arquivo não parece uma planilha .xlsx.')
  const rels = new Map<string, string>()
  for (const r of children(parseXml(text('xl/_rels/workbook.xml.rels') ?? '<x/>').children[0], 'Relationship')) {
    rels.set(r.attrs['Id']!, resolvePath('xl/workbook.xml', r.attrs['Target']!))
  }
  const shared = children(parseXml(text('xl/sharedStrings.xml') ?? '<sst/>').children[0], 'si').map((si) => textOf(si))
  const styles = readStyles(text('xl/styles.xml'))

  const sheets: Sheet[] = []
  for (const s of children(find(parseXml(wbXml), 'sheets'), 'sheet')) {
    const sheet = newSheet(s.attrs['name'] ?? `Planilha${sheets.length + 1}`)
    const path = rels.get(s.attrs['r:id'] ?? '')
    const xml = path ? text(path) : undefined
    if (xml) readSheet(parseXml(xml), sheet, shared, styles)
    sheets.push(sheet)
  }
  if (!sheets.length) sheets.push(newSheet('Planilha1'))
  return { sheets }
}

function readSheet(doc: XmlNode, sheet: Sheet, shared: string[], styles: CellStyle[]): void {
  for (const c of children(find(doc, 'cols'), 'col')) {
    if (c.attrs['customWidth'] !== '1' && !c.attrs['width']) continue
    const w = Math.round(Number(c.attrs['width']) * 7 + 5)
    const min = Number(c.attrs['min'])
    const max = Math.min(Number(c.attrs['max']), min + 200)
    for (let i = min; i <= max; i++) sheet.cols[i - 1] = w
  }
  // Fórmulas compartilhadas: a "mestra" define, as outras só citam o índice.
  const sharedF = new Map<string, { f: string; col: number; row: number }>()
  for (const row of children(find(doc, 'sheetData'), 'row')) {
    if (row.attrs['customHeight'] === '1' && row.attrs['ht']) sheet.rows[Number(row.attrs['r']) - 1] = Math.round(Number(row.attrs['ht']) * 1.333)
    for (const c of children(row, 'c')) {
      const ref = c.attrs['r']
      if (!ref) continue
      const { col, row: r } = splitRef(ref)
      const t = c.attrs['t']
      const vNode = child(c, 'v')
      const fNode = child(c, 'f')
      let v: Cell['v'] = null
      if (t === 's') v = shared[Number(vNode?.text ?? -1)] ?? ''
      else if (t === 'inlineStr') v = textOf(child(c, 'is'))
      else if (t === 'b') v = vNode?.text === '1'
      else if (t === 'str' || t === 'e') v = vNode?.text ?? ''
      else if (vNode && vNode.text !== '') v = Number(vNode.text)
      let f: string | undefined
      if (fNode) {
        const si = fNode.attrs['si']
        if (fNode.text) {
          f = fNode.text
          if (fNode.attrs['t'] === 'shared' && si !== undefined) sharedF.set(si, { f, col, row: r })
        } else if (si !== undefined && sharedF.has(si)) {
          const m = sharedF.get(si)!
          f = shiftFormula(m.f, col - m.col, r - m.row)
        }
      }
      const style = styles[Number(c.attrs['s'] ?? 0)]
      const cell: Cell = { v }
      if (f) cell.f = f
      if (style && Object.keys(style).length) cell.s = style
      if (v !== null || f || cell.s) sheet.cells.set(key(col, r), cell)
    }
  }
}

// ------------------------------------------------------------ gravação

const FMT_CODE: Record<Exclude<NumFmt, 'general'>, { id: number; code?: string }> = {
  number: { id: 4 },
  integer: { id: 3 },
  percent: { id: 10 },
  date: { id: 14 },
  currency: { id: 164, code: '"R$" #,##0.00;-"R$" #,##0.00' },
}

const hexArgb = (hex: string) => `FF${hex.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6)}`

/** Monta styles.xml com fontes, preenchimentos e formatos únicos. */
function buildStyles(wb: Workbook): { xml: string; index(style?: CellStyle): number } {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>']
  const fontKeys = new Map<string, number>([['', 0]])
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
  const fillKeys = new Map<string, number>([['', 0]])
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  const xfKeys = new Map<string, number>([['', 0]])

  const fontId = (s: CellStyle) => {
    const k = [s.b, s.i, s.u, s.s, s.color, s.size].map((v) => v ?? '').join('|')
    if (k === '|||||') return 0
    let id = fontKeys.get(k)
    if (id === undefined) {
      id = fonts.length
      fontKeys.set(k, id)
      fonts.push(
        `<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}${s.s ? '<strike/>' : ''}${s.u ? '<u/>' : ''}<sz val="${s.size ?? 11}"/>${s.color ? `<color rgb="${hexArgb(s.color)}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`,
      )
    }
    return id
  }
  const fillId = (s: CellStyle) => {
    if (!s.fill) return 0
    let id = fillKeys.get(s.fill)
    if (id === undefined) {
      id = fills.length
      fillKeys.set(s.fill, id)
      fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${hexArgb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`)
    }
    return id
  }
  const index = (s?: CellStyle) => {
    if (!s || !Object.keys(s).length) return 0
    const f = fontId(s)
    const fi = fillId(s)
    const num = s.fmt && s.fmt !== 'general' ? FMT_CODE[s.fmt].id : 0
    const k = `${f}|${fi}|${num}|${s.align ?? ''}|${s.wrap ? 1 : 0}`
    let id = xfKeys.get(k)
    if (id === undefined) {
      id = xfs.length
      xfKeys.set(k, id)
      const align = s.align || s.wrap ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>` : ''
      xfs.push(
        `<xf numFmtId="${num}" fontId="${f}" fillId="${fi}" borderId="0" xfId="0"${f ? ' applyFont="1"' : ''}${fi ? ' applyFill="1"' : ''}${num ? ' applyNumberFormat="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`,
      )
    }
    return id
  }
  // Pré-registra todos os estilos usados.
  for (const sh of wb.sheets) for (const c of sh.cells.values()) index(c.s)

  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="${x(FMT_CODE.currency.code!)}"/></numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  return { xml, index }
}

export function writeXlsx(wb: Workbook): Uint8Array {
  const calc = new Calc(wb)
  const strings: string[] = []
  const stringIndex = new Map<string, number>()
  const sst = (s: string) => {
    let i = stringIndex.get(s)
    if (i === undefined) {
      i = strings.length
      strings.push(s)
      stringIndex.set(s, i)
    }
    return i
  }
  const styles = buildStyles(wb)
  const files: Record<string, Uint8Array> = {}

  wb.sheets.forEach((sheet, si) => {
    const rows = new Map<number, Array<{ col: number; cell: Cell }>>()
    for (const [k, cell] of sheet.cells) {
      const [c, r] = k.split(',').map(Number) as [number, number]
      if (!rows.has(r)) rows.set(r, [])
      rows.get(r)!.push({ col: c, cell })
    }
    for (const r of Object.keys(sheet.rows).map(Number)) if (!rows.has(r)) rows.set(r, [])
    let maxCol = 0
    let maxRow = 0
    const rowXml: string[] = []
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      const cells = rows.get(r)!.sort((a, b) => a.col - b.col)
      const ht = sheet.rows[r]
      const cellXml = cells
        .map(({ col, cell }) => {
          maxCol = Math.max(maxCol, col)
          maxRow = Math.max(maxRow, r)
          const ref = `${colName(col)}${r + 1}`
          const s = styles.index(cell.s)
          const sAttr = s ? ` s="${s}"` : ''
          if (cell.f) {
            const value = calc.value(si, col, r)
            const f = `<f>${x(toFileFormula(cell.f))}</f>`
            if (typeof value === 'number') return `<c r="${ref}"${sAttr}>${f}<v>${value}</v></c>`
            if (typeof value === 'boolean') return `<c r="${ref}"${sAttr} t="b">${f}<v>${value ? 1 : 0}</v></c>`
            if (value === null) return `<c r="${ref}"${sAttr}>${f}</c>`
            if (typeof value === 'object') return `<c r="${ref}"${sAttr} t="e">${f}<v>${x(String(value))}</v></c>`
            return `<c r="${ref}"${sAttr} t="str">${f}<v>${x(String(value))}</v></c>`
          }
          if (typeof cell.v === 'number') return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`
          if (typeof cell.v === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${cell.v ? 1 : 0}</v></c>`
          if (typeof cell.v === 'string' && cell.v !== '') return `<c r="${ref}"${sAttr} t="s"><v>${sst(cell.v)}</v></c>`
          return s ? `<c r="${ref}"${sAttr}/>` : ''
        })
        .join('')
      rowXml.push(`<row r="${r + 1}"${ht ? ` ht="${(ht * 0.75).toFixed(2)}" customHeight="1"` : ''}>${cellXml}</row>`)
    }
    const cols = Object.entries(sheet.cols)
      .map(([c, w]) => ({ c: Number(c), w }))
      .sort((a, b) => a.c - b.c)
      .map(({ c, w }) => `<col min="${c + 1}" max="${c + 1}" width="${Math.max(1, (w - 5) / 7).toFixed(2)}" customWidth="1"/>`)
      .join('')
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<dimension ref="A1${maxCol || maxRow ? `:${colName(maxCol)}${maxRow + 1}` : ''}"/>` +
        `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews>` +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        (cols ? `<cols>${cols}</cols>` : '') +
        `<sheetData>${rowXml.join('')}</sheetData>` +
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
        '</worksheet>',
    )
  })

  const sheetEntries = wb.sheets.map((s, i) => `<sheet name="${x(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  files['xl/workbook.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<bookViews><workbookView/></bookViews><sheets>${sheetEntries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  )
  const n = wb.sheets.length
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>',
  )
  files['xl/styles.xml'] = strToU8(styles.xml)
  files['xl/sharedStrings.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
      strings.map((s) => `<si><t xml:space="preserve">${x(s)}</t></si>`).join('') +
      '</sst>',
  )
  files['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  )
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  )
  files['docProps/app.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Opalite</Application></Properties>',
  )
  return zipSync(files, { level: 6 })
}

// ------------------------------------------------------------ CSV

/** Lê CSV detectando ";" (comum no Brasil) ou ",". */
export function readCsv(text: string): Workbook {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) && firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ','
  const sheet = newSheet('Planilha1')
  let row = 0
  let col = 0
  let field = ''
  let quoted = false
  const push = () => {
    if (field !== '') {
      const n = sep === ';' ? Number(field.replace(/\./g, '').replace(',', '.')) : Number(field)
      sheet.cells.set(key(col, row), { v: field.trim() !== '' && Number.isFinite(n) && /^-?[\d.,]+$/.test(field.trim()) ? n : field })
    }
    field = ''
    col++
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === sep) push()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      push()
      row++
      col = 0
    } else field += c
  }
  if (field !== '' || col > 0) push()
  return { sheets: [sheet] }
}

export function writeCsv(sheet: Sheet, wb: Workbook): string {
  const calc = new Calc(wb)
  const si = wb.sheets.indexOf(sheet)
  let maxR = -1
  let maxC = -1
  for (const k of sheet.cells.keys()) {
    const [c, r] = k.split(',').map(Number) as [number, number]
    maxR = Math.max(maxR, r)
    maxC = Math.max(maxC, c)
  }
  const lines: string[] = []
  for (let r = 0; r <= maxR; r++) {
    const fields: string[] = []
    for (let c = 0; c <= maxC; c++) {
      const v = calc.value(si, c, r)
      let s = v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
      if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
      fields.push(s)
    }
    lines.push(fields.join(';'))
  }
  return lines.join('\r\n') + '\r\n'
}
