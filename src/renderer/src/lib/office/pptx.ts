import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { type Para, type Presentation, type Run, SLIDE_H, SLIDE_W, type ShapeKind, type Slide, type SlideEl, canRound, radiusOf, uid } from './presentation'
import { type XmlNode, child, children, escapeXml as x, find, findAll, local, parseXml } from './xml'

/*
 * Leitura e gravação de .pptx (PresentationML) feitas aqui mesmo. Cobre
 * caixas de texto (parágrafos, alinhamento, marcadores e numeração,
 * espaçamento entre linhas, negrito/itálico/sublinhado/tachado, tamanho, cor,
 * fonte e espaçamento entre letras), formas básicas, imagens, borda,
 * cantos arredondados, opacidade, rotação e a cor de fundo de cada slide. Animações, transições, gráficos, tabelas, vídeo e SmartArt
 * de arquivos vindos de outros programas não são lidos.
 */

const EMU = 9525
const toEmu = (px: number) => Math.round(px * EMU)

// ------------------------------------------------------------ leitura

type Theme = Record<string, string>

function readTheme(xml: string | undefined): Theme {
  const out: Theme = { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47' }
  if (!xml) return out
  const scheme = find(parseXml(xml), 'clrScheme')
  for (const c of scheme?.children ?? []) {
    const name = local(c.name)
    const srgb = find(c, 'srgbClr')?.attrs['val']
    const sys = find(c, 'sysClr')?.attrs['lastClr']
    if (srgb || sys) out[name] = `#${(srgb ?? sys)!.toLowerCase()}`
  }
  return out
}

function colorOf(node: XmlNode | undefined, theme: Theme): string | undefined {
  if (!node) return undefined
  const srgb = child(node, 'srgbClr')
  if (srgb) return `#${srgb.attrs['val']!.toLowerCase()}`
  const scheme = child(node, 'schemeClr')
  if (scheme) {
    const alias: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }
    const v = scheme.attrs['val']!
    return theme[alias[v] ?? v]
  }
  return undefined
}

/** Opacidade (0–1) de um preenchimento: <a:srgbClr><a:alpha val="50000"/></a:srgbClr>. */
function alphaOf(node: XmlNode | undefined): number | undefined {
  const clr = child(node, 'srgbClr') ?? child(node, 'schemeClr')
  const a = child(clr, 'alpha')?.attrs['val']
  return a ? Math.max(0, Math.min(1, Number(a) / 100000)) : undefined
}

const resolve = (base: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function relsOf(files: Record<string, Uint8Array>, part: string): Map<string, string> {
  const dir = part.slice(0, part.lastIndexOf('/'))
  const name = part.slice(part.lastIndexOf('/') + 1)
  const raw = files[`${dir}/_rels/${name}.rels`]
  const map = new Map<string, string>()
  if (!raw) return map
  for (const r of findAll(parseXml(strFromU8(raw)), 'Relationship')) {
    if (r.attrs['TargetMode'] === 'External') continue
    map.set(r.attrs['Id']!, resolve(part, r.attrs['Target']!))
  }
  return map
}

interface Xfrm {
  x: number
  y: number
  w: number
  h: number
  rot?: number
}

function xfrmOf(spPr: XmlNode | undefined, scale: number): Xfrm | null {
  const xf = child(spPr, 'xfrm')
  const off = child(xf, 'off')
  const ext = child(xf, 'ext')
  if (!off || !ext) return null
  const rot = Number(xf!.attrs['rot'] ?? 0) / 60000
  return {
    x: (Number(off.attrs['x']) / EMU) * scale,
    y: (Number(off.attrs['y']) / EMU) * scale,
    w: (Number(ext.attrs['cx']) / EMU) * scale,
    h: (Number(ext.attrs['cy']) / EMU) * scale,
    ...(rot ? { rot } : {}),
  }
}

/** Posição de um placeholder herdada do layout/mestre (quando o slide não define). */
function placeholderXfrm(ph: XmlNode | undefined, layouts: XmlNode[], scale: number): Xfrm | null {
  if (!ph) return null
  const type = ph.attrs['type'] ?? 'body'
  const idx = ph.attrs['idx']
  for (const doc of layouts) {
    for (const sp of findAll(doc, 'sp')) {
      const other = find(child(sp, 'nvSpPr'), 'ph')
      if (!other) continue
      const sameIdx = idx !== undefined && other.attrs['idx'] === idx
      const sameType = (other.attrs['type'] ?? 'body') === type || (type === 'ctrTitle' && other.attrs['type'] === 'title')
      if (sameIdx || sameType) {
        const xf = xfrmOf(child(sp, 'spPr'), scale)
        if (xf) return xf
      }
    }
  }
  return null
}

function readParas(txBody: XmlNode | undefined, theme: Theme, isTitle: boolean): Para[] {
  const paras: Para[] = []
  for (const p of children(txBody, 'p')) {
    const pPr = child(p, 'pPr')
    const algn = pPr?.attrs['algn']
    const para: Para = { runs: [] }
    if (algn === 'ctr') para.align = 'center'
    else if (algn === 'r') para.align = 'right'
    if (child(pPr, 'buAutoNum')) para.numbered = true
    else if (child(pPr, 'buChar')) para.bullet = true
    const lnPct = child(child(pPr, 'lnSpc'), 'spcPct')?.attrs['val']
    if (lnPct && Number(lnPct) && Number(lnPct) !== 100000) para.lineHeight = Math.round(Number(lnPct) / 1000) / 100
    for (const r of p.children) {
      const name = local(r.name)
      if (name === 'br') {
        para.runs.push({ text: '\n' })
        continue
      }
      if (name !== 'r' && name !== 'fld') continue
      const rPr = child(r, 'rPr')
      const run: Run = { text: child(r, 't')?.text ?? '' }
      if (rPr?.attrs['b'] === '1') run.b = true
      if (rPr?.attrs['i'] === '1') run.i = true
      if (rPr?.attrs['u'] && rPr.attrs['u'] !== 'none') run.u = true
      if (rPr?.attrs['strike'] && rPr.attrs['strike'] !== 'noStrike') run.s = true
      if (rPr?.attrs['sz']) run.size = Number(rPr.attrs['sz']) / 100
      else run.size = isTitle ? 36 : 18
      const color = colorOf(child(rPr, 'solidFill'), theme)
      if (color) run.color = color
      const font = child(rPr, 'latin')?.attrs['typeface']
      if (font && !font.startsWith('+')) run.font = font
      if (rPr?.attrs['spc'] && Number(rPr.attrs['spc'])) run.spacing = Number(rPr.attrs['spc']) / 100
      para.runs.push(run)
    }
    paras.push(para)
  }
  return paras
}

/** Raio dos cantos de um roundRect (ajuste "adj" em 1/100000 do lado menor). */
function radiusFromGeom(spPr: XmlNode | undefined, w: number, h: number): number | undefined {
  const geom = child(spPr, 'prstGeom')
  if (geom?.attrs['prst'] !== 'roundRect') return undefined
  const fmla = findAll(geom, 'gd').find((g) => g.attrs['name'] === 'adj')?.attrs['fmla']
  const adj = fmla ? Number(/val\s+(-?\d+)/.exec(fmla)?.[1] ?? 16667) : 16667
  return Math.round(((Math.min(w, h) * Math.max(0, Math.min(50000, adj))) / 100000) * 10) / 10
}

/** Borda (<a:ln>): cor e espessura em pt. */
function lineOf(spPr: XmlNode | undefined, theme: Theme): { stroke?: string; strokeWidth?: number } {
  const ln = child(spPr, 'ln')
  if (!ln || child(ln, 'noFill')) return {}
  const stroke = colorOf(child(ln, 'solidFill'), theme)
  if (!stroke) return {}
  return { stroke, ...(ln.attrs['w'] ? { strokeWidth: Math.round((Number(ln.attrs['w']) / 12700) * 100) / 100 } : {}) }
}

const PRESET: Record<string, ShapeKind> = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', line: 'line', straightConnector1: 'line', rightArrow: 'arrow' }

function readShapes(
  tree: XmlNode,
  ctx: { files: Record<string, Uint8Array>; rels: Map<string, string>; theme: Theme; layouts: XmlNode[]; scale: number },
  out: SlideEl[],
  group?: { ox: number; oy: number; sx: number; sy: number },
): void {
  const map = (xf: Xfrm): Xfrm =>
    group ? { x: group.ox + xf.x * group.sx, y: group.oy + xf.y * group.sy, w: xf.w * group.sx, h: xf.h * group.sy, rot: xf.rot } : xf
  for (const node of tree.children) {
    const name = local(node.name)
    if (name === 'sp') {
      const spPr = child(node, 'spPr')
      const ph = find(child(node, 'nvSpPr'), 'ph')
      const xf = xfrmOf(spPr, ctx.scale) ?? placeholderXfrm(ph, ctx.layouts, ctx.scale)
      if (!xf) continue
      const isTitle = ph?.attrs['type'] === 'title' || ph?.attrs['type'] === 'ctrTitle'
      const paras = readParas(child(node, 'txBody'), ctx.theme, isTitle)
      const prst = child(spPr, 'prstGeom')?.attrs['prst']
      const fill = colorOf(child(spPr, 'solidFill'), ctx.theme)
      const { stroke, strokeWidth } = lineOf(spPr, ctx.theme)
      // Opacidade: do preenchimento ou, sem ele, da cor do texto.
      const alpha = alphaOf(child(spPr, 'solidFill')) ?? alphaOf(child(find(child(node, 'txBody'), 'rPr'), 'solidFill'))
      const anchor = child(child(node, 'txBody'), 'bodyPr')?.attrs['anchor']
      const valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'
      const pos = map(xf)
      const radius = radiusFromGeom(spPr, pos.w, pos.h)
      const extra = { ...(stroke ? { stroke } : {}), ...(strokeWidth ? { strokeWidth } : {}), ...(alpha !== undefined && alpha < 1 ? { opacity: alpha } : {}) }
      const isTextBox = find(child(node, 'nvSpPr'), 'cNvSpPr')?.attrs['txBox'] === '1' || ph !== undefined
      // Forma: não é caixa de texto e tem geometria própria ou contorno/preenchimento.
      const isShape = !isTextBox && ((prst !== undefined && prst !== 'rect') || Boolean(fill || stroke))
      if (isShape) {
        const shape = PRESET[prst ?? 'rect'] ?? 'rect'
        out.push({ id: uid(), type: 'shape', shape, ...pos, ...extra, ...(radius !== undefined ? { radius } : {}), fill, paras, valign })
      } else if (paras.some((p) => p.runs.some((r) => r.text.trim())) || fill || stroke) {
        out.push({ id: uid(), type: 'text', ...pos, ...extra, ...(radius ? { radius } : {}), paras, ...(fill ? { fill } : {}), valign })
      }
    } else if (name === 'pic') {
      const blip = find(child(node, 'blipFill'), 'blip')
      const embed = blip?.attrs['r:embed']
      const target = embed ? ctx.rels.get(embed) : undefined
      const data = target ? ctx.files[target] : undefined
      const xf = xfrmOf(child(node, 'spPr'), ctx.scale)
      if (!data || !xf) continue
      const ext = target!.slice(target!.lastIndexOf('.') + 1).toLowerCase()
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
      const pos = map(xf)
      const spPr = child(node, 'spPr')
      const amt = child(blip, 'alphaModFix')?.attrs['amt']
      const opacity = amt ? Math.max(0, Math.min(1, Number(amt) / 100000)) : 1
      const radius = radiusFromGeom(spPr, pos.w, pos.h)
      out.push({ id: uid(), type: 'image', ...pos, ...lineOf(spPr, ctx.theme), ...(radius ? { radius } : {}), ...(opacity < 1 ? { opacity } : {}), data, mime })
    } else if (name === 'grpSp') {
      const xf = child(child(node, 'grpSpPr'), 'xfrm')
      const off = child(xf, 'off')
      const ext = child(xf, 'ext')
      const chOff = child(xf, 'chOff')
      const chExt = child(xf, 'chExt')
      if (off && ext && chOff && chExt) {
        const s = ctx.scale / EMU
        const sx = Number(chExt.attrs['cx']) ? Number(ext.attrs['cx']) / Number(chExt.attrs['cx']) : 1
        const sy = Number(chExt.attrs['cy']) ? Number(ext.attrs['cy']) / Number(chExt.attrs['cy']) : 1
        const inner = { ox: Number(off.attrs['x']) * s - Number(chOff.attrs['x']) * s * sx, oy: Number(off.attrs['y']) * s - Number(chOff.attrs['y']) * s * sy, sx, sy }
        const g = group ? { ox: group.ox + inner.ox * group.sx, oy: group.oy + inner.oy * group.sy, sx: inner.sx * group.sx, sy: inner.sy * group.sy } : inner
        readShapes(node, ctx, out, g)
      } else readShapes(node, ctx, out, group)
    }
  }
}

export function readPptx(bytes: Uint8Array): Presentation {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('Arquivo .pptx inválido ou corrompido.')
  }
  const presXml = files['ppt/presentation.xml']
  if (!presXml) throw new Error('Este arquivo não parece uma apresentação .pptx.')
  const pres = parseXml(strFromU8(presXml))
  const sz = find(pres, 'sldSz')
  const cx = Number(sz?.attrs['cx'] ?? 9144000)
  const scale = SLIDE_W / (cx / EMU)
  const height = Math.round((Number(sz?.attrs['cy'] ?? 5143500) / EMU) * scale)
  const presRels = relsOf(files, 'ppt/presentation.xml')
  const themePath = [...presRels.values()].find((p) => p.includes('theme/'))
  const theme = readTheme(themePath && files[themePath] ? strFromU8(files[themePath]!) : undefined)

  const slides: Slide[] = []
  for (const s of findAll(find(pres, 'sldIdLst'), 'sldId')) {
    const path = presRels.get(s.attrs['r:id'] ?? '')
    if (!path || !files[path]) continue
    const doc = parseXml(strFromU8(files[path]!))
    const rels = relsOf(files, path)
    // Layout e mestre (para posições herdadas e fundo).
    const layouts: XmlNode[] = []
    const layoutPath = [...rels.values()].find((p) => p.includes('slideLayouts/'))
    if (layoutPath && files[layoutPath]) {
      layouts.push(parseXml(strFromU8(files[layoutPath]!)))
      const masterPath = [...relsOf(files, layoutPath).values()].find((p) => p.includes('slideMasters/'))
      if (masterPath && files[masterPath]) layouts.push(parseXml(strFromU8(files[masterPath]!)))
    }
    const bgOf = (d: XmlNode) => colorOf(child(find(d, 'bgPr'), 'solidFill'), theme)
    const background = bgOf(doc) ?? layouts.map(bgOf).find(Boolean) ?? '#ffffff'
    const elements: SlideEl[] = []
    const tree = find(doc, 'spTree')
    if (tree) readShapes(tree, { files, rels, theme, layouts, scale }, elements)
    slides.push({ id: uid('s'), background, elements })
  }
  if (!slides.length) slides.push({ id: uid('s'), background: '#ffffff', elements: [] })
  return { width: SLIDE_W, height: height || SLIDE_H, slides }
}

// ------------------------------------------------------------ gravação

const hex = (c: string) => c.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6)
const clrXml = (c: string, alpha = 1) => (alpha < 1 ? `<a:srgbClr val="${hex(c)}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${hex(c)}"/>`)
const fillXml = (c?: string, alpha = 1) => (c ? `<a:solidFill>${clrXml(c, alpha)}</a:solidFill>` : '<a:noFill/>')
const lnXml = (stroke: string | undefined, width: number | undefined, alpha = 1) =>
  stroke ? `<a:ln w="${Math.round((width ?? 1) * 12700)}">${fillXml(stroke, alpha)}</a:ln>` : '<a:ln><a:noFill/></a:ln>'

/** Geometria: retângulo ou, com raio, roundRect com o ajuste equivalente. */
function geomXml(el: SlideEl, prst: string): string {
  if (!canRound(el)) return `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>`
  const r = radiusOf(el)
  if (!r) return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
  const adj = Math.round(Math.min(50000, (r / Math.max(1, Math.min(el.w, el.h))) * 100000))
  return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`
}

function parasXml(paras: Para[], valign: string | undefined, alpha = 1, inset = true): string {
  const anchor = valign === 'middle' ? 'ctr' : valign === 'bottom' ? 'b' : 't'
  const ps = (paras.length ? paras : [{ runs: [] }])
    .map((p) => {
      const algn = p.align === 'center' ? 'ctr' : p.align === 'right' ? 'r' : 'l'
      const ln = p.lineHeight && p.lineHeight !== 1 ? `<a:lnSpc><a:spcPct val="${Math.round(p.lineHeight * 100000)}"/></a:lnSpc>` : ''
      const pPr = p.numbered
        ? `<a:pPr marL="342900" indent="-342900" algn="${algn}">${ln}<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/></a:pPr>`
        : p.bullet
          ? `<a:pPr marL="285750" indent="-285750" algn="${algn}">${ln}<a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>`
          : `<a:pPr algn="${algn}">${ln}<a:buNone/></a:pPr>`
      const runs = p.runs
        .flatMap((r) => r.text.split('\n').map((t, i) => ({ ...r, text: t, br: i > 0 })))
        .map((r) => {
          const attrs = [
            `lang="pt-BR"`,
            `sz="${Math.round((r.size ?? 18) * 100)}"`,
            r.b ? 'b="1"' : '',
            r.i ? 'i="1"' : '',
            r.u ? 'u="sng"' : '',
            r.s ? 'strike="sngStrike"' : '',
            r.spacing ? `spc="${Math.round(r.spacing * 100)}"` : '',
            'dirty="0"',
          ]
            .filter(Boolean)
            .join(' ')
          const color = r.color ?? (alpha < 1 ? '#1f2430' : undefined)
          const inner = `${color ? fillXml(color, alpha) : ''}${r.font ? `<a:latin typeface="${x(r.font)}"/><a:cs typeface="${x(r.font)}"/>` : ''}`
          return `${r.br ? '<a:br/>' : ''}<a:r><a:rPr ${attrs}>${inner}</a:rPr><a:t>${x(r.text)}</a:t></a:r>`
        })
        .join('')
      const size = Math.round((p.runs[0]?.size ?? 18) * 100)
      return `<a:p>${pPr}${runs}<a:endParaRPr lang="pt-BR" sz="${size}" dirty="0"/></a:p>`
    })
    .join('')
  const ins = inset ? '' : ' lIns="0" tIns="0" rIns="0" bIns="0"'
  return `<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${anchor}"${ins}><a:normAutofit/></a:bodyPr><a:lstStyle/>${ps}</p:txBody>`
}

const xfrm = (e: { x: number; y: number; w: number; h: number; rot?: number }) =>
  `<a:xfrm${e.rot ? ` rot="${Math.round(e.rot * 60000)}"` : ''}><a:off x="${toEmu(e.x)}" y="${toEmu(e.y)}"/><a:ext cx="${toEmu(Math.max(1, e.w))}" cy="${toEmu(Math.max(1, e.h))}"/></a:xfrm>`

const PRST: Record<ShapeKind, string> = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', line: 'line', arrow: 'rightArrow' }

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Opalite"><a:themeElements><a:clrScheme name="Opalite"><a:dk1><a:srgbClr val="1F2430"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2E3340"/></a:dk2><a:lt2><a:srgbClr val="F2F1EE"/></a:lt2><a:accent1><a:srgbClr val="7C6CF0"/></a:accent1><a:accent2><a:srgbClr val="4FB3BF"/></a:accent2><a:accent3><a:srgbClr val="F2A65A"/></a:accent3><a:accent4><a:srgbClr val="E06C9F"/></a:accent4><a:accent5><a:srgbClr val="6BBF59"/></a:accent5><a:accent6><a:srgbClr val="5B8DEF"/></a:accent6><a:hlink><a:srgbClr val="5B8DEF"/></a:hlink><a:folHlink><a:srgbClr val="7C6CF0"/></a:folHlink></a:clrScheme><a:fontScheme name="Opalite"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Opalite"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`

const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`

const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Em branco"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

export function writePptx(p: Presentation): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const scale = 1 // modelo já está em px de 960×540
  const W = Math.round(p.width * scale)
  const H = Math.round(p.height * scale)
  let media = 0
  const mediaTypes = new Set<string>()

  p.slides.forEach((slide, si) => {
    const rels: string[] = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`]
    let shapeId = 2
    const shapes = slide.elements
      .map((e) => {
        const id = shapeId++
        if (e.type === 'image') {
          media += 1
          const ext = e.mime === 'image/jpeg' ? 'jpeg' : e.mime === 'image/gif' ? 'gif' : 'png'
          mediaTypes.add(ext)
          const target = `image${media}.${ext}`
          files[`ppt/media/${target}`] = e.data
          const rid = `rId${rels.length + 1}`
          rels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="../media/${target}"/>`)
          const alpha = e.opacity ?? 1
          const blip = alpha < 1 ? `<a:blip r:embed="${rid}"><a:alphaModFix amt="${Math.round(alpha * 100000)}"/></a:blip>` : `<a:blip r:embed="${rid}"/>`
          return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Imagem ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(e)}${geomXml(e, 'rect')}${e.stroke ? lnXml(e.stroke, e.strokeWidth, alpha) : ''}</p:spPr></p:pic>`
        }
        const alpha = e.opacity ?? 1
        if (e.type === 'shape') {
          const ln = e.shape === 'line' ? lnXml(e.stroke ?? '#1f2430', e.strokeWidth ?? 1.5, alpha) : lnXml(e.stroke, e.strokeWidth ?? 1.5, alpha)
          return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Forma ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(e)}${geomXml(e, PRST[e.shape])}${e.shape === 'line' ? '<a:noFill/>' : fillXml(e.fill, alpha)}${ln}</p:spPr>${parasXml(e.paras, e.valign ?? 'middle', alpha)}</p:sp>`
        }
        return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Texto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(e)}${geomXml(e, 'rect')}${fillXml(e.fill, alpha)}${e.stroke ? lnXml(e.stroke, e.strokeWidth, alpha) : ''}</p:spPr>${parasXml(e.paras, e.valign, alpha)}</p:sp>`
      })
      .join('')
    files[`ppt/slides/slide${si + 1}.xml`] = strToU8(
      `${XML}<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${fillXml(slide.background || '#ffffff')}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    )
    files[`ppt/slides/_rels/slide${si + 1}.xml.rels`] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`)
  })

  const n = p.slides.length
  files['ppt/presentation.xml'] = strToU8(
    `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${p.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${toEmu(W)}" cy="${toEmu(H)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  )
  files['ppt/_rels/presentation.xml.rels'] = strToU8(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${p.slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`,
  )
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(MASTER)
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
  )
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(LAYOUT)
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  )
  files['ppt/theme/theme1.xml'] = strToU8(THEME)
  files['docProps/app.xml'] = strToU8(`${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Opalite</Application><Slides>${n}</Slides></Properties>`)
  files['_rels/.rels'] = strToU8(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  )
  const mime: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif' }
  files['[Content_Types].xml'] = strToU8(
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...mediaTypes].map((e) => `<Default Extension="${e}" ContentType="${mime[e]}"/>`).join('')}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${p.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  )
  return zipSync(files, { level: 6 })
}
