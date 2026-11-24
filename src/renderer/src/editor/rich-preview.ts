import { type ImageOpts, formatImageLink, parseImageOpts } from './image-opts'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { maskCode } from '../../../shared/markdown/parse'
import type { NoteSummary } from '../../../shared/types'
import { evaluateBase, parseBase } from '../lib/base'
import { notesChanged } from './links'

/*
 * Live preview "rico", complementar ao live-preview.ts:
 * - ==realce== e <mark style="...">realce colorido</mark>
 * - %%comentários%% (esmaecidos), notas de rodapé [^1]
 * - destaques (callouts): "> [!note] Título"
 * - equações KaTeX: $inline$ e blocos $$ ... $$
 * - bases: blocos ```base viram uma tabela viva de notas
 * Na linha (ou bloco) onde o cursor está, o Markdown original aparece.
 */

export interface PreviewHandlers {
  notes(): NoteSummary[]
  version(): number
  currentPath(): string | null
  openNote(path: string): void
  /** Caminho de um anexo citado em ![[...]] (ou null). */
  resolveFile(target: string): string | null
  /** URL "blob:" para exibir uma imagem do cofre. */
  imageUrl(path: string): Promise<string>
}

let handlers: PreviewHandlers = {
  notes: () => [],
  version: () => 0,
  currentPath: () => null,
  openNote: () => undefined,
  resolveFile: () => null,
  imageUrl: () => Promise.reject(new Error('indisponível')),
}

export function setPreviewHandlers(next: PreviewHandlers): void {
  handlers = next
}

const hidden = Decoration.replace({})
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText'])
// Só aceitamos estilos de fundo simples vindos do <mark>, nada de url() ou expressões.
const SAFE_STYLE = /^\s*background(-color)?\s*:\s*[-a-z0-9#(),.%\s]+;?\s*$/i

function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true
  }
  return false
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n)
  }
  return lines
}

// KaTeX (~270 KB) só é carregado quando a primeira fórmula aparece.
type Katex = typeof import('katex').default
let katexLib: Katex | null = null
let katexLoading: Promise<Katex> | null = null
function loadKatex(): Promise<Katex> {
  katexLoading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (katexLib = m.default))
  return katexLoading
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super()
  }
  override eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-opal-math-block' : 'cm-opal-math'
    const render = (k: Katex) => {
      el.innerHTML = k.renderToString(this.tex, { displayMode: this.display, throwOnError: false, strict: 'ignore' })
    }
    if (katexLib) render(katexLib)
    else {
      el.textContent = this.tex
      el.classList.add('cm-opal-math-loading')
      void loadKatex().then((k) => {
        el.classList.remove('cm-opal-math-loading')
        render(k)
      })
    }
    return el
  }
  override ignoreEvent(): boolean {
    return false // clicar posiciona o cursor e revela o código
  }
}

const CALLOUT_LABELS: Record<string, string> = {
  note: 'Nota', info: 'Informação', tip: 'Dica', success: 'Sucesso', question: 'Pergunta',
  warning: 'Atenção', danger: 'Perigo', bug: 'Erro', example: 'Exemplo', quote: 'Citação', abstract: 'Resumo', todo: 'Tarefa',
}
const CALLOUT_GROUP: Record<string, string> = {
  note: 'blue', info: 'blue', todo: 'blue', abstract: 'teal', tip: 'teal', success: 'green',
  question: 'orange', warning: 'orange', danger: 'red', bug: 'red', example: 'purple', quote: 'gray',
}

const EMBED_IMAGE = /^!\[\[([^\]|#\n]+\.[a-z0-9]{2,5})((?:\|[^\]|\n]*)*)\]\]/i

let selectedImage: HTMLElement | null = null
const deselect = () => {
  selectedImage?.removeAttribute('data-selected')
  selectedImage = null
}
document.addEventListener('mousedown', (e) => {
  if (selectedImage && !selectedImage.contains(e.target as Node)) deselect()
})

const svgIcon = (d: string) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`

/** Imagem do cofre dentro da nota, com redimensionamento e alinhamento. */
class ImageEmbed extends WidgetType {
  constructor(
    readonly path: string,
    readonly opts: ImageOpts,
  ) {
    super()
  }
  override eq(o: ImageEmbed): boolean {
    return o.path === this.path && JSON.stringify(o.opts) === JSON.stringify(this.opts)
  }

  /** Regrava o link da imagem com as novas opções. */
  private write(view: EditorView, wrap: HTMLElement, patch: Partial<ImageOpts>): void {
    const pos = view.posAtDOM(wrap)
    const line = view.state.doc.lineAt(pos)
    const m = EMBED_IMAGE.exec(view.state.doc.sliceString(pos, line.to))
    if (!m) return
    const opts = { ...parseImageOpts(m[2] ?? ''), ...patch }
    view.dispatch({ changes: { from: pos, to: pos + m[0].length, insert: formatImageLink(m[1]!, opts) }, userEvent: 'input.image' })
  }

  toDOM(view: EditorView): HTMLElement {
    const o = this.opts
    const wrap = document.createElement('span')
    wrap.className = 'cm-opal-embed-image'
    if (o.align) wrap.dataset['align'] = o.align
    if (o.height) wrap.dataset['free'] = 'true'
    const frame = document.createElement('span')
    frame.className = 'cm-opal-img-frame'
    const img = document.createElement('img')
    img.alt = o.alt ?? this.path.slice(this.path.lastIndexOf('/') + 1)
    img.draggable = false
    if (o.width) img.style.width = `${o.width}px`
    if (o.height) {
      img.style.height = `${o.height}px`
      img.style.objectFit = 'fill'
    }
    void handlers
      .imageUrl(this.path)
      .then((u) => (img.src = u))
      .catch(() => wrap.classList.add('cm-opal-embed-missing'))
    frame.append(img)

    // Alças: direita, base e canto (Shift no canto libera a proporção).
    const size = document.createElement('span')
    size.className = 'cm-opal-img-size'
    for (const h of ['e', 's', 'se']) {
      const handle = document.createElement('span')
      handle.className = 'cm-opal-img-handle'
      handle.dataset['h'] = h
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const sx = e.clientX
        const sy = e.clientY
        const w0 = img.offsetWidth
        const h0 = img.offsetHeight
        const ratio = h0 / Math.max(1, w0)
        const locked = wrap.dataset['free'] !== 'true'
        const maxW = Math.max(80, (view.contentDOM.clientWidth || 800) - 20)
        let w = w0
        let hh = h0
        let freeHeight = Boolean(o.height)
        const move = (ev: PointerEvent) => {
          if (h !== 's') w = Math.max(40, Math.min(maxW, w0 + ev.clientX - sx))
          if (h === 's' || (h === 'se' && (!locked || ev.shiftKey))) {
            hh = Math.max(30, h0 + ev.clientY - sy)
            freeHeight = true
          } else if (locked) {
            hh = w * ratio
            freeHeight = false
          }
          img.style.width = `${Math.round(w)}px`
          img.style.height = freeHeight ? `${Math.round(hh)}px` : ''
          img.style.objectFit = freeHeight ? 'fill' : ''
          size.textContent = `${Math.round(w)} × ${Math.round(freeHeight ? hh : w * ratio)}`
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          wrap.removeAttribute('data-resizing')
          this.write(view, wrap, { width: Math.round(w), height: freeHeight ? Math.round(hh) : null })
        }
        wrap.dataset['resizing'] = 'true'
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      })
      frame.append(handle)
    }
    frame.append(size)

    // Barra de opções: alinhamento, proporção, dimensões e tamanho original.
    const bar = document.createElement('span')
    bar.className = 'cm-opal-img-bar'
    const button = (svg: string, title: string, on: boolean, run: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.innerHTML = svg
      b.title = title
      b.setAttribute('aria-label', title)
      if (on) b.dataset['on'] = 'true'
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        run()
      })
      bar.append(b)
      return b
    }
    button(svgIcon('<path d="M4 6h16M4 12h10M4 18h14"/>'), 'Alinhar à esquerda', (o.align ?? 'left') === 'left', () => this.write(view, wrap, { align: null }))
    button(svgIcon('<path d="M4 6h16M7 12h10M5 18h14"/>'), 'Centralizar', o.align === 'center', () => this.write(view, wrap, { align: 'center' }))
    button(svgIcon('<path d="M4 6h16M10 12h10M6 18h14"/>'), 'Alinhar à direita', o.align === 'right', () => this.write(view, wrap, { align: 'right' }))
    bar.append(document.createElement('i'))
    const lock = button(svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), o.height ? 'Proporção livre (clique para manter)' : 'Manter proporção (clique para liberar)', !o.height, () => {
      const free = wrap.dataset['free'] !== 'true'
      wrap.dataset['free'] = String(free)
      lock.dataset['on'] = String(!free)
      lock.title = free ? 'Proporção livre (clique para manter)' : 'Manter proporção (clique para liberar)'
      if (!free) this.write(view, wrap, { height: null })
    })
    const dims = document.createElement('span')
    dims.className = 'cm-opal-img-dims'
    const field = (value: number | null, title: string, apply: (n: number) => void) => {
      const input = document.createElement('input')
      input.type = 'number'
      input.min = '20'
      input.max = '4000'
      input.placeholder = 'auto'
      input.title = title
      input.setAttribute('aria-label', title)
      if (value) input.value = String(value)
      input.addEventListener('mousedown', (e) => e.stopPropagation())
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') input.blur()
      })
      input.addEventListener('change', () => {
        const n = Number(input.value)
        if (n >= 20) apply(n)
      })
      dims.append(input)
    }
    field(o.width, 'Largura (px)', (n) => this.write(view, wrap, { width: n }))
    dims.append('×')
    field(o.height, 'Altura (px), vazio mantém a proporção', (n) => this.write(view, wrap, { height: n, width: o.width ?? img.offsetWidth }))
    bar.append(dims)
    button(svgIcon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'), 'Tamanho original', false, () => this.write(view, wrap, { width: null, height: null }))

    wrap.append(frame, bar)
    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.cm-opal-img-bar, .cm-opal-img-handle')) return
      e.preventDefault()
      deselect()
      selectedImage = wrap
      wrap.dataset['selected'] = 'true'
      size.textContent = `${img.offsetWidth} × ${img.offsetHeight}`
    })
    wrap.addEventListener('dblclick', () => handlers.openNote(this.path))
    return wrap
  }
  // O editor não trata cliques na imagem (senão o cursor iria para a linha e
  // a imagem viraria texto); a própria imagem cuida da seleção.
  override ignoreEvent(): boolean {
    return true
  }
}

/** ![[relatorio.pdf]] (ou anexo não encontrado): cartão clicável. */
class FileEmbed extends WidgetType {
  constructor(
    readonly target: string,
    readonly path: string | null,
  ) {
    super()
  }
  override eq(o: FileEmbed): boolean {
    return o.target === this.target && o.path === this.path
  }
  toDOM(): HTMLElement {
    const card = document.createElement('span')
    card.className = 'cm-opal-embed-file'
    if (!this.path) card.classList.add('cm-opal-embed-missing')
    const badge = document.createElement('span')
    badge.className = 'cm-opal-embed-badge'
    badge.textContent = (this.target.split('.').pop() ?? '').toUpperCase()
    const name = document.createElement('span')
    name.className = 'cm-opal-embed-name'
    name.textContent = this.target.slice(this.target.lastIndexOf('/') + 1)
    const hint = document.createElement('span')
    hint.className = 'cm-opal-embed-hint'
    hint.textContent = this.path ? 'Abrir' : 'Arquivo não encontrado'
    card.append(badge, name, hint)
    card.addEventListener('mousedown', (e) => {
      if (!this.path) return
      e.preventDefault()
      e.stopPropagation()
      handlers.openNote(this.path)
    })
    return card
  }
  override ignoreEvent(): boolean {
    return true
  }
}

class CalloutLabel extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  override eq(other: CalloutLabel): boolean {
    return other.label === this.label
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-opal-callout-label'
    el.textContent = this.label
    return el
  }
}

function buildInline(view: EditorView): DecorationSet {
  const { state } = view
  const active = activeLines(state)
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number)
  const out: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to)

    for (const m of text.matchAll(/==(?=\S)([^=\n]*?\S)==/g)) {
      const s = from + m.index
      const e = s + m[0].length
      if (inCode(state, s)) continue
      out.push(Decoration.mark({ class: 'cm-opal-highlight' }).range(s + 2, e - 2))
      if (!isActive(s)) out.push(hidden.range(s, s + 2), hidden.range(e - 2, e))
    }

    for (const m of text.matchAll(/<mark(?:\s+style="([^"]*)")?\s*>([^<\n]*)<\/mark>/gi)) {
      const s = from + m.index
      const e = s + m[0].length
      if (inCode(state, s)) continue
      const open = m[0].indexOf('>') + 1
      // <mark></mark> vazio (recém-inserido, cursor no meio): decoração de marca não pode ser vazia.
      if (!m[2]) {
        if (!isActive(s)) out.push(hidden.range(s, e))
        continue
      }
      const style = m[1] && SAFE_STYLE.test(m[1]) ? m[1] : ''
      out.push(
        Decoration.mark({ class: 'cm-opal-highlight cm-opal-highlight-color', attributes: style ? { style } : {} }).range(
          s + open,
          e - 7,
        ),
      )
      if (!isActive(s)) out.push(hidden.range(s, s + open), hidden.range(e - 7, e))
    }

    // Anexos incorporados: imagens aparecem; PDFs e outros viram cartões.
    for (const m of text.matchAll(/!\[\[([^\]|#\n]+\.([a-z0-9]{2,5}))((?:\|[^\]|\n]*)*)\]\]/gi)) {
      const s = from + m.index
      const e = s + m[0].length
      const ext = m[2]!.toLowerCase()
      if (ext === 'md' || ext === 'canvas' || inCode(state, s) || isActive(s)) continue
      const path = handlers.resolveFile(m[1]!)
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)
      const widget = isImage && path ? new ImageEmbed(path, parseImageOpts(m[3] ?? '')) : new FileEmbed(m[1]!, path)
      out.push(Decoration.replace({ widget }).range(s, e))
    }

    for (const m of text.matchAll(/%%[^\n]*?%%/g)) {
      const s = from + m.index
      if (inCode(state, s)) continue
      out.push(Decoration.mark({ class: 'cm-opal-comment' }).range(s, s + m[0].length))
    }

    for (const m of text.matchAll(/\[\^[^\]\s]+\]/g)) {
      const s = from + m.index
      if (inCode(state, s)) continue
      out.push(Decoration.mark({ class: 'cm-opal-footnote' }).range(s, s + m[0].length))
    }

    // $inline$: exige não-espaço junto aos cifrões e nenhum dígito logo após o
    // fechamento, para "custa $5 e $10" não virar equação.
    for (const m of text.matchAll(/(?<![\\$])\$(?=[^\s$])([^$\n]*?[^\s\\$])\$(?![$\d])/g)) {
      const s = from + m.index
      if (inCode(state, s) || isActive(s)) continue
      out.push(Decoration.replace({ widget: new MathWidget(m[1]!, false) }).range(s, s + m[0].length))
    }
  }

  // Destaques (callouts): percorre as linhas visíveis.
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = state.doc.lineAt(pos)
      const head = /^>\s*\[!(\w+)\][+-]?\s*(.*)$/.exec(line.text)
      if (head && !inCode(state, line.from)) {
        const type = head[1]!.toLowerCase()
        const group = CALLOUT_GROUP[type] ?? 'blue'
        out.push(Decoration.line({ class: `cm-opal-callout cm-opal-callout-${group} cm-opal-callout-title` }).range(line.from))
        if (!active.has(line.number)) {
          const markerEnd = line.from + line.text.indexOf(']') + 1
          const title = head[2]!.trim()
          out.push(
            Decoration.replace({ widget: new CalloutLabel(title ? '' : (CALLOUT_LABELS[type] ?? type)) }).range(
              line.from,
              Math.min(line.to, markerEnd + (title ? 1 : 0)),
            ),
          )
        }
        // Linhas seguintes que começam com ">" fazem parte do destaque.
        let next = line.number + 1
        while (next <= state.doc.lines) {
          const l = state.doc.line(next)
          if (!/^>/.test(l.text)) break
          out.push(Decoration.line({ class: `cm-opal-callout cm-opal-callout-${group}` }).range(l.from))
          if (!active.has(l.number)) {
            const prefix = /^>\s?/.exec(l.text)![0].length
            if (prefix) out.push(hidden.range(l.from, l.from + prefix))
          }
          next++
        }
        if (next > state.doc.lines) break
        pos = state.doc.line(next).from
        continue
      }
      pos = line.to + 1
    }
  }

  return Decoration.set(out, true)
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildInline(u.view)
      }
    }
  },
  { decorations: (p) => p.decorations },
)

// ------------------------------------------------------------ blocos (StateField)

class BaseWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly version: number,
    readonly path: string | null,
  ) {
    super()
  }
  override eq(other: BaseWidget): boolean {
    return other.source === this.source && other.version === this.version && other.path === this.path
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-opal-base'
    const spec = parseBase(this.source)
    const header = document.createElement('div')
    header.className = 'cm-opal-base-header'
    if (spec.error) {
      header.textContent = spec.error
      header.classList.add('cm-opal-base-error')
      wrap.append(header)
      return wrap
    }
    const rows = evaluateBase(spec, handlers.notes(), this.path)
    header.textContent = `Base · ${rows.length} ${rows.length === 1 ? 'nota' : 'notas'}${spec.filter ? ` · ${spec.filter}` : ''}`
    wrap.append(header)

    const table = document.createElement('table')
    const thead = table.createTHead().insertRow()
    for (const col of spec.columns) {
      const th = document.createElement('th')
      th.textContent = col
      thead.append(th)
    }
    const tbody = table.createTBody()
    for (const row of rows) {
      const tr = tbody.insertRow()
      row.cells.forEach((value, i) => {
        const td = tr.insertCell()
        if (i === 0) {
          const a = document.createElement('a')
          a.textContent = value || row.path
          a.dataset['path'] = row.path
          a.className = 'cm-opal-base-link'
          td.append(a)
        } else {
          td.textContent = value
        }
      })
    }
    if (rows.length === 0) {
      const tr = tbody.insertRow()
      const td = tr.insertCell()
      td.colSpan = spec.columns.length
      td.className = 'cm-opal-base-empty'
      td.textContent = 'Nenhuma nota corresponde ao filtro.'
    }
    wrap.append(table)
    wrap.addEventListener('mousedown', (e) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>('[data-path]')
      if (!link) return
      e.preventDefault()
      e.stopPropagation()
      handlers.openNote(link.dataset['path']!)
    })
    return wrap
  }
  override ignoreEvent(event: Event): boolean {
    // Cliques nos links da tabela ficam com o widget; o resto revela o código.
    return event.type === 'mousedown' && Boolean((event.target as HTMLElement).closest('[data-path]'))
  }
}

/** Frontmatter recolhido: chips "chave valor"; clicar revela o YAML para editar. */
class PropertiesWidget extends WidgetType {
  constructor(readonly entries: Array<[string, string]>) {
    super()
  }
  override eq(o: PropertiesWidget): boolean {
    return JSON.stringify(o.entries) === JSON.stringify(this.entries)
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-opal-props'
    const label = document.createElement('span')
    label.className = 'cm-opal-props-label'
    label.textContent = 'Propriedades'
    wrap.append(label)
    for (const [key, value] of this.entries) {
      const chip = document.createElement('span')
      chip.className = 'cm-opal-prop'
      const k = document.createElement('b')
      k.textContent = key
      const v = document.createElement('span')
      v.textContent = value.length > 48 ? `${value.slice(0, 47)}…` : value
      chip.append(k, v)
      wrap.append(chip)
    }
    return wrap
  }
  override ignoreEvent(): boolean {
    return false
  }
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}

interface BlockField {
  decorations: DecorationSet
  /** Todos os blocos substituíveis (frontmatter, base, equação), com ou sem cursor. */
  blocks: Array<[number, number]>
  /** Quais blocos têm o cursor dentro (se não mudar, não há o que redesenhar). */
  activeKey: string
}

function activeKeyOf(state: EditorState, blocks: Array<[number, number]>): string {
  let key = ''
  blocks.forEach(([from, to], i) => {
    if (selectionTouches(state, from, to)) key += `${i},`
  })
  return key
}

function buildBlocks(state: EditorState): BlockField {
  const doc = state.doc.toString()
  const out: Range<Decoration>[] = []
  const blocks: Array<[number, number]> = []

  const fm = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/.exec(doc)
  if (fm) {
    blocks.push([0, fm[0].length])
    if (!selectionTouches(state, 0, fm[0].length)) {
      const entries: Array<[string, string]> = []
      for (const line of fm[1]!.split(/\r?\n/)) {
        const m = /^([\w\- ]+):\s*(.*)$/.exec(line)
        if (m) entries.push([m[1]!.trim(), m[2]!.replace(/^["']|["']$/g, '') || '…'])
      }
      out.push(Decoration.replace({ widget: new PropertiesWidget(entries), block: true }).range(0, fm[0].length))
    }
  }

  // ```base ... ``` (atalho: nem procura se o texto não tem o marcador)
  if (doc.includes('```base')) {
    for (const m of doc.matchAll(/^```base[ \t]*\n([\s\S]*?)^```[ \t]*$/gm)) {
      const from = m.index
      const to = from + m[0].length
      blocks.push([from, to])
      if (selectionTouches(state, from, to)) continue
      out.push(
        Decoration.replace({
          widget: new BaseWidget(m[1]!, handlers.version(), handlers.currentPath()),
          block: true,
        }).range(from, to),
      )
    }
  }

  // $$ ... $$ fora de blocos de código
  if (doc.includes('$$')) {
    const masked = maskCode(doc)
    for (const m of masked.matchAll(/^\$\$[ \t]*\n?([\s\S]*?)\n?\$\$[ \t]*$/gm)) {
      const from = m.index
      const to = from + m[0].length
      const tex = doc.slice(from, to).replace(/^\$\$/, '').replace(/\$\$\s*$/, '').trim()
      if (!tex) continue
      blocks.push([from, to])
      if (selectionTouches(state, from, to)) continue
      out.push(Decoration.replace({ widget: new MathWidget(tex, true), block: true }).range(from, to))
    }
  }
  return { decorations: Decoration.set(out, true), blocks, activeKey: activeKeyOf(state, blocks) }
}

const blockPreview = StateField.define<BlockField>({
  create: (state) => buildBlocks(state),
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(notesChanged))) return buildBlocks(tr.state)
    if (tr.selection && activeKeyOf(tr.state, value.blocks) !== value.activeKey) return buildBlocks(tr.state)
    return value
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.decorations),
})

export const richPreview = [inlinePreview, blockPreview]
