import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { isValidTag, splitLinkInner } from '../../../shared/markdown/parse'

/*
 * Wikilinks e tags dentro do editor:
 * - destaca [[links]] (com cor diferente para notas que ainda não existem);
 * - no live preview, esconde os colchetes e, se houver apelido, o destino;
 * - clique (fora da linha em edição) ou Ctrl+clique abre a nota;
 * - clique em #tag abre a busca por aquela tag.
 */

export interface LinkHandlers {
  /** Caminho da nota para onde o link aponta, ou null se não existir. */
  resolve(target: string): string | null
  openLink(target: string, section: string | null, newTab: boolean): void
  openTag(tag: string): void
}

let handlers: LinkHandlers = {
  resolve: () => null,
  openLink: () => undefined,
  openTag: () => undefined,
}

export function setLinkHandlers(next: LinkHandlers): void {
  handlers = next
}

/** Dispare este efeito quando a lista de notas mudar (links podem passar a existir). */
export const notesChanged = StateEffect.define<null>()

const hidden = Decoration.replace({})
const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'HTMLBlock', 'Comment'])

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true
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

function build(view: EditorView): DecorationSet {
  const { state } = view
  const active = activeLines(state)
  const out: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to)

    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index
      const end = start + m[0].length
      if (inCode(state, start)) continue
      const { target, section, alias } = splitLinkInner(m[2]!)
      const exists = !target || handlers.resolve(target) !== null
      const embedLen = m[1]!.length
      const innerStart = start + embedLen + 2
      const innerEnd = end - 2
      const lineActive = active.has(state.doc.lineAt(start).number)

      out.push(
        Decoration.mark({
          class: exists ? 'cm-opal-wikilink' : 'cm-opal-wikilink cm-opal-wikilink-missing',
          attributes: { 'data-link-target': target, 'data-link-section': section ?? '' },
        }).range(start, end),
      )
      if (!lineActive) {
        // Esconde "![[" / "[[", "]]" e, com apelido, o "destino|".
        const visibleFrom = alias ? innerEnd - (m[2]!.length - m[2]!.indexOf('|') - 1) : innerStart
        out.push(hidden.range(start, visibleFrom))
        out.push(hidden.range(innerEnd, end))
      }
    }

    for (const m of text.matchAll(TAG)) {
      const tag = m[2]!
      if (!isValidTag(tag)) continue
      const start = from + m.index + m[1]!.length
      if (inCode(state, start)) continue
      // "#" dentro de [[Nota#Seção]] não é tag.
      const before = state.doc.sliceString(Math.max(0, start - 200), start)
      if (/\[\[[^\]\n]*$/.test(before)) continue
      out.push(
        Decoration.mark({ class: 'cm-opal-tag', attributes: { 'data-tag': tag } }).range(start, start + tag.length + 1),
      )
    }
  }
  return Decoration.set(out, true)
}

const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(notesChanged)))
      ) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (p) => p.decorations },
)

/**
 * Clique: na linha em edição o clique só posiciona o cursor (para poder
 * editar o link); fora dela, ou com Ctrl/Cmd, abre o link.
 */
const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-link-target], [data-tag]')
    const mod = event.ctrlKey || event.metaKey

    if (!el) {
      // Ctrl+clique em [texto](https://...) abre no navegador.
      if (!mod) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      const node = syntaxTree(view.state).resolveInner(pos, 1)
      const link = node.name === 'URL' ? node : node.parent?.getChild('URL')
      const url = link ? view.state.sliceDoc(link.from, link.to) : ''
      if (!/^https?:\/\//i.test(url)) return false
      event.preventDefault()
      window.open(url, '_blank')
      return true
    }

    const pos = view.posAtDOM(el)
    const lineActive = activeLines(view.state).has(view.state.doc.lineAt(pos).number)
    if (lineActive && !mod) return false
    event.preventDefault()
    if (el.dataset['tag']) handlers.openTag(el.dataset['tag'])
    else handlers.openLink(el.dataset['linkTarget'] ?? '', el.dataset['linkSection'] || null, mod && !lineActive)
    return true
  },
})

export const wikilinks = [linkDecorations, linkClicks]
