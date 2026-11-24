import type { CSSProperties } from 'react'
import { type Para, type Run, type ShapeEl, type Slide, type SlideEl, fontFromCss, radiusOf } from '../../lib/office/presentation'
import { PT, parasToHtml } from '../../lib/office/slide-html'
import styles from './PresentationEditor.module.css'

export { parasToHtml }

/*
 * Desenho de um slide (miniaturas, edição e modo apresentação) e a conversão
 * entre o texto editável (HTML) e o modelo de parágrafos.
 *
 * O modelo é alterado no lugar pelo editor, então nada aqui é memorizado por
 * identidade de objeto: cada renderização desenha o estado atual (é isso que
 * mantém as miniaturas em dia enquanto se move, redimensiona ou digita).
 */

/** Lê o HTML editado de volta para parágrafos (herdando o estilo de base). */
export function htmlToParas(root: HTMLElement, base: Partial<Run>): Para[] {
  const paras: Para[] = []
  const pushPara = (el: HTMLElement | null, list: 'bullet' | 'numbered' | null, nodes: Node[]) => {
    const runs: Run[] = []
    const walk = (node: Node, inherited: Partial<Run>) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/​/g, '')
        if (text) runs.push({ ...inherited, text })
        return
      }
      if (!(node instanceof HTMLElement)) return
      if (node.tagName === 'BR') {
        runs.push({ ...inherited, text: '\n' })
        return
      }
      const r: Partial<Run> = { ...inherited }
      const s = node.style
      const tag = node.tagName
      if (tag === 'B' || tag === 'STRONG' || s.fontWeight === 'bold' || Number(s.fontWeight) >= 600) r.b = true
      if (s.fontWeight === 'normal' || s.fontWeight === '400') r.b = false
      if (tag === 'I' || tag === 'EM' || s.fontStyle === 'italic') r.i = true
      if (s.fontStyle === 'normal') r.i = false
      const deco = `${s.textDecoration} ${s.textDecorationLine}`
      if (tag === 'U' || deco.includes('underline')) r.u = true
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through')) r.s = true
      if (s.fontSize) {
        const px = parseFloat(s.fontSize)
        if (px) r.size = Math.round((px / PT) * 2) / 2
      }
      if (s.color) r.color = toHex(s.color) ?? r.color
      if (tag === 'FONT' && node.getAttribute('color')) r.color = toHex(node.getAttribute('color')!) ?? r.color
      if (s.fontFamily) r.font = fontFromCss(s.fontFamily) ?? r.font
      if (tag === 'FONT' && node.getAttribute('face')) r.font = fontFromCss(node.getAttribute('face')!) ?? r.font
      if (s.letterSpacing) {
        const px = parseFloat(s.letterSpacing)
        r.spacing = px ? Math.round((px / PT) * 10) / 10 : undefined
      }
      for (const c of node.childNodes) walk(c, r)
    }
    for (const n of nodes) walk(n, base)
    // Remove a quebra final que o navegador põe em parágrafos vazios.
    while (runs.length && runs[runs.length - 1]!.text === '\n') runs.pop()
    const align = el?.style.textAlign
    const lh = el ? parseFloat(el.style.lineHeight) : NaN
    paras.push({
      runs: runs.length ? merge(runs) : [{ ...base, text: '' }],
      ...(align === 'center' || align === 'right' ? { align } : {}),
      ...(list === 'bullet' ? { bullet: true } : list === 'numbered' ? { numbered: true } : {}),
      ...(lh && lh !== 1 && !el!.style.lineHeight.endsWith('px') ? { lineHeight: lh } : {}),
    })
  }
  let loose: Node[] = []
  const flush = () => {
    if (loose.length) pushPara(null, null, loose)
    loose = []
  }
  const visit = (container: Node) => {
    for (const node of [...container.childNodes]) {
      if (node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')) {
        flush()
        // Um div que só embrulha uma lista (o navegador faz isso às vezes).
        if ([...node.children].some((c) => c.tagName === 'UL' || c.tagName === 'OL')) visit(node)
        else pushPara(node, null, [...node.childNodes])
      } else if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
        flush()
        const kind = node.tagName === 'OL' ? 'numbered' : 'bullet'
        for (const li of node.children) pushPara(li as HTMLElement, kind, [...li.childNodes])
      } else loose.push(node)
    }
  }
  visit(root)
  flush()
  return paras
}

function merge(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    const last = out[out.length - 1]
    if (last && last.b === r.b && last.i === r.i && last.u === r.u && last.s === r.s && last.size === r.size && last.color === r.color && last.font === r.font && last.spacing === r.spacing) last.text += r.text
    else out.push({ ...r })
  }
  return out
}

function toHex(c: string): string | undefined {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : undefined
}

/** URL de imagem (blob) memorizada por elemento. */
const blobs = new WeakMap<Uint8Array, string>()
export function imageUrl(data: Uint8Array, mime: string): string {
  let url = blobs.get(data)
  if (!url) {
    url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
    blobs.set(data, url)
  }
  return url
}

/** Espessura da borda em px (o modelo guarda em pt). */
export const strokePx = (el: SlideEl) => (el.strokeWidth ?? (el.type === 'shape' ? 1.5 : 1)) * PT

function ShapeSvg({ el }: { el: ShapeEl }) {
  const stroke = el.stroke ?? (el.shape === 'line' ? '#1f2430' : 'none')
  const sw = stroke === 'none' ? 0 : strokePx(el)
  const fill = el.shape === 'line' ? 'none' : (el.fill ?? 'transparent')
  const w = Math.max(1, el.w)
  const h = Math.max(1, el.h)
  const r = radiusOf(el)
  return (
    <svg className={styles.shapeSvg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {(el.shape === 'rect' || el.shape === 'roundRect') && (
        <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={Math.max(0, r - sw / 2)} fill={fill} stroke={stroke} strokeWidth={sw} />
      )}
      {el.shape === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} fill={fill} stroke={stroke} strokeWidth={sw} />}
      {el.shape === 'triangle' && <polygon points={`${w / 2},${sw} ${w - sw},${h - sw} ${sw},${h - sw}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />}
      {el.shape === 'arrow' && (
        <polygon points={`0,${h * 0.3} ${w * 0.65},${h * 0.3} ${w * 0.65},0 ${w},${h / 2} ${w * 0.65},${h} ${w * 0.65},${h * 0.7} 0,${h * 0.7}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      )}
      {el.shape === 'line' && <line x1={0} y1={0} x2={w} y2={h} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />}
    </svg>
  )
}

/** Caixa (posição, tamanho e rotação) de um elemento no slide de 960×540. */
export function boxStyle(el: SlideEl): CSSProperties {
  return { left: el.x, top: el.y, width: el.w, height: Math.max(el.h, 2), transform: el.rot ? `rotate(${el.rot}deg)` : undefined }
}

/** Fundo, borda e cantos de caixas de texto e imagens (as formas desenham isso no SVG). */
function frameStyle(el: SlideEl): CSSProperties {
  if (el.type === 'shape') return {}
  const r = radiusOf(el)
  return {
    ...(el.type === 'text' && el.fill ? { background: el.fill } : {}),
    ...(el.stroke ? { border: `${strokePx(el)}px solid ${el.stroke}` } : {}),
    ...(r ? { borderRadius: r } : {}),
  }
}

export function ElementView({ el, editing }: { el: SlideEl; editing?: boolean }) {
  const opacity = el.opacity !== undefined && el.opacity < 1 ? el.opacity : undefined
  if (el.type === 'image') return <img className={styles.image} style={{ ...frameStyle(el), opacity }} src={imageUrl(el.data, el.mime)} alt="" draggable={false} />
  return (
    <div className={styles.content} style={{ ...frameStyle(el), opacity }}>
      {el.type === 'shape' && <ShapeSvg el={el} />}
      {!editing && <div className={styles.text} data-valign={el.valign ?? (el.type === 'shape' ? 'middle' : 'top')} dangerouslySetInnerHTML={{ __html: parasToHtml(el.paras) }} />}
    </div>
  )
}

/** Slide inteiro, desenhado em 960×540 e escalado por CSS. */
export function SlideView({ slide, scale }: { slide: Slide; scale: number }) {
  return (
    <div className={styles.slideStatic} style={{ background: slide.background, transform: `scale(${scale})` }}>
      {slide.elements.map((el) => (
        <div key={el.id} className={styles.el} style={boxStyle(el)}>
          <ElementView el={el} />
        </div>
      ))}
    </div>
  )
}
