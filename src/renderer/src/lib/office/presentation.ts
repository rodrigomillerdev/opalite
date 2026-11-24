/*
 * Modelo de apresentação (independente do formato). Coordenadas em px num
 * slide de 960×540 (16:9); no .pptx isso vira EMU (1 px = 9525 EMU).
 */

export interface Run {
  text: string
  b?: boolean
  i?: boolean
  u?: boolean
  /** Tachado. */
  s?: boolean
  /** Tamanho em pt. */
  size?: number
  color?: string
  font?: string
  /** Espaçamento entre letras, em pt (pode ser negativo). */
  spacing?: number
}

export interface Para {
  runs: Run[]
  align?: 'left' | 'center' | 'right'
  /** Lista com marcadores. */
  bullet?: boolean
  /** Lista numerada (1. 2. 3.). Tem precedência sobre `bullet`. */
  numbered?: boolean
  /** Altura da linha como múltiplo do tamanho da fonte (1 = simples). */
  lineHeight?: number
}

interface Base {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Rotação em graus. */
  rot?: number
  /** 0 a 1 (ausente = opaco). */
  opacity?: number
  /** Cor da borda (ausente = sem borda; numa linha, a cor do traço). */
  stroke?: string
  /** Espessura da borda em pt. */
  strokeWidth?: number
  /** Arredondamento dos cantos em px (caixas de texto, imagens e retângulos). */
  radius?: number
}

export interface TextEl extends Base {
  type: 'text'
  paras: Para[]
  fill?: string
  valign?: 'top' | 'middle' | 'bottom'
}

export type ShapeKind = 'rect' | 'roundRect' | 'ellipse' | 'triangle' | 'line' | 'arrow'

export interface ShapeEl extends Base {
  type: 'shape'
  shape: ShapeKind
  fill?: string
  paras: Para[]
  valign?: 'top' | 'middle' | 'bottom'
}

export interface ImageEl extends Base {
  type: 'image'
  data: Uint8Array
  mime: string
}

export type SlideEl = TextEl | ShapeEl | ImageEl

export interface Slide {
  id: string
  background: string
  elements: SlideEl[]
  notes?: string
}

export interface Presentation {
  width: number
  height: number
  slides: Slide[]
}

export const SLIDE_W = 960
export const SLIDE_H = 540

let counter = 0
export const uid = (p = 'e') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`

/** Formas que aceitam cantos arredondados. */
export const canRound = (el: SlideEl) => el.type !== 'shape' || el.shape === 'rect' || el.shape === 'roundRect'

/** Raio efetivo: o "retângulo arredondado" sem raio próprio usa 1/6 do lado menor (como no PowerPoint). */
export function radiusOf(el: SlideEl): number {
  if (!canRound(el)) return 0
  if (el.radius !== undefined) return Math.max(0, Math.min(el.radius, Math.min(el.w, el.h) / 2))
  return el.type === 'shape' && el.shape === 'roundRect' ? Math.min(el.w, el.h) / 6 : 0
}

// ------------------------------------------------------------ fontes

export interface FontChoice {
  /** Nome gravado no .pptx. */
  name: string
  /** Pilha CSS usada para desenhar (com substitutas livres no Linux). */
  css: string
  group: 'Sem serifa' | 'Com serifa' | 'Monoespaçada'
}

export const DEFAULT_FONT = 'Calibri'

export const FONTS: FontChoice[] = [
  { name: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', sans-serif", group: 'Sem serifa' },
  { name: 'Inter', css: "'Inter Variable', Inter, sans-serif", group: 'Sem serifa' },
  { name: 'Arial', css: "Arial, 'Liberation Sans', Helvetica, sans-serif", group: 'Sem serifa' },
  { name: 'Verdana', css: "Verdana, 'DejaVu Sans', sans-serif", group: 'Sem serifa' },
  { name: 'Trebuchet MS', css: "'Trebuchet MS', 'Ubuntu', sans-serif", group: 'Sem serifa' },
  { name: 'Georgia', css: "Georgia, 'Gelasio', 'DejaVu Serif', serif", group: 'Com serifa' },
  { name: 'Times New Roman', css: "'Times New Roman', 'Liberation Serif', Times, serif", group: 'Com serifa' },
  { name: 'Garamond', css: "Garamond, 'EB Garamond', 'Liberation Serif', serif", group: 'Com serifa' },
  { name: 'Courier New', css: "'Courier New', 'Liberation Mono', monospace", group: 'Monoespaçada' },
  { name: 'JetBrains Mono', css: "'JetBrains Mono Variable', 'JetBrains Mono', monospace", group: 'Monoespaçada' },
]

/** Pilha CSS para um nome de fonte (fontes desconhecidas caem na sem serifa). */
export function fontCss(name: string | undefined): string {
  if (!name) return FONTS[0]!.css
  const known = FONTS.find((f) => f.name.toLowerCase() === name.toLowerCase())
  return known ? known.css : `'${name.replace(/['"\\]/g, '')}', ${FONTS[0]!.css}`
}

/** Nome da fonte a partir de um font-family do CSS (o inverso de fontCss). */
export function fontFromCss(css: string): string | undefined {
  const first = css.split(',')[0]?.replace(/["']/g, '').trim()
  if (!first) return undefined
  const known = FONTS.find((f) => f.css.split(',')[0]!.replace(/["']/g, '').trim().toLowerCase() === first.toLowerCase() || f.name.toLowerCase() === first.toLowerCase())
  return known ? known.name : first
}

// ------------------------------------------------------------ layouts

const TITLE = '#1f2430'
const BODY = '#2e3340'

export function titleSlide(title = 'Título da apresentação', subtitle = 'Subtítulo'): Slide {
  return {
    id: uid('s'),
    background: '#ffffff',
    elements: [
      { id: uid(), type: 'text', x: 80, y: 170, w: 800, h: 110, valign: 'bottom', paras: [{ align: 'center', runs: [{ text: title, size: 40, b: true, color: TITLE }] }] },
      { id: uid(), type: 'text', x: 80, y: 295, w: 800, h: 60, valign: 'top', paras: [{ align: 'center', runs: [{ text: subtitle, size: 20, color: '#5b6170' }] }] },
    ],
  }
}

const heading = (text: string) => ({ id: uid(), type: 'text' as const, x: 60, y: 36, w: 840, h: 76, valign: 'middle' as const, paras: [{ runs: [{ text, size: 32, b: true, color: TITLE }] }] })

const bullets = (x: number, w: number, items: string[]) => ({
  id: uid(),
  type: 'text' as const,
  x,
  y: 130,
  w,
  h: 360,
  valign: 'top' as const,
  paras: items.map((text) => ({ bullet: true, runs: [{ text, size: 22, color: BODY }] })),
})

export function contentSlide(title = 'Título do slide'): Slide {
  return { id: uid('s'), background: '#ffffff', elements: [heading(title), bullets(60, 840, ['Primeiro tópico', 'Segundo tópico'])] }
}

export function twoColumnSlide(title = 'Título do slide'): Slide {
  return {
    id: uid('s'),
    background: '#ffffff',
    elements: [heading(title), bullets(60, 405, ['Primeiro tópico', 'Segundo tópico']), bullets(495, 405, ['Primeiro tópico', 'Segundo tópico'])],
  }
}

export function titleOnlySlide(title = 'Título do slide'): Slide {
  return { id: uid('s'), background: '#ffffff', elements: [heading(title)] }
}

export function sectionSlide(title = 'Nova seção'): Slide {
  return {
    id: uid('s'),
    background: '#ffffff',
    elements: [
      { id: uid(), type: 'shape', shape: 'rect', x: 80, y: 300, w: 64, h: 6, fill: '#7c6cf0', paras: [{ runs: [{ text: '' }] }], valign: 'middle' },
      { id: uid(), type: 'text', x: 70, y: 200, w: 820, h: 92, valign: 'bottom', paras: [{ runs: [{ text: title, size: 36, b: true, color: TITLE }] }] },
    ],
  }
}

export function blankSlide(background = '#ffffff'): Slide {
  return { id: uid('s'), background, elements: [] }
}

export type LayoutId = 'title' | 'content' | 'twoColumns' | 'titleOnly' | 'section' | 'blank'

export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: 'title', label: 'Slide de título' },
  { id: 'content', label: 'Título e conteúdo' },
  { id: 'twoColumns', label: 'Duas colunas' },
  { id: 'titleOnly', label: 'Somente título' },
  { id: 'section', label: 'Cabeçalho de seção' },
  { id: 'blank', label: 'Em branco' },
]

/** Slide novo no layout pedido, com o fundo dado. */
export function layoutSlide(id: LayoutId, background = '#ffffff'): Slide {
  const s =
    id === 'title'
      ? titleSlide()
      : id === 'twoColumns'
        ? twoColumnSlide()
        : id === 'titleOnly'
          ? titleOnlySlide()
          : id === 'section'
            ? sectionSlide()
            : id === 'blank'
              ? blankSlide()
              : contentSlide()
  s.background = background
  // Em fundo escuro, o texto dos modelos fica claro para continuar legível.
  if (isDark(background)) for (const el of s.elements) if (el.type !== 'image') for (const p of el.paras) for (const r of p.runs) r.color = '#f2f1ee'
  return s
}

export function isDark(color: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return false
  const n = parseInt(m[1]!, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

export function newPresentation(): Presentation {
  return { width: SLIDE_W, height: SLIDE_H, slides: [titleSlide()] }
}

/** Cópia profunda de um slide com ids novos (duplicar). */
export function cloneSlide(slide: Slide): Slide {
  return {
    ...slide,
    id: uid('s'),
    elements: slide.elements.map((e) => ({ ...structuredClone(e), id: uid() })),
  }
}

export const plainText = (paras: Para[]) => paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
