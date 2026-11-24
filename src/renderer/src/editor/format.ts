import { EditorSelection } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

/*
 * Formatação extra: realces coloridos, limpar formatação, nota de rodapé,
 * destaques (callouts), equações e bases. As funções de texto puras ficam
 * separadas dos comandos para poderem ser testadas sem editor.
 */

export const HIGHLIGHTS = [
  { id: 'default', label: 'Padrão', style: null },
  {
    id: 'opalite',
    label: 'Opalite',
    style:
      'background: linear-gradient(115deg, rgba(124,178,255,.38), rgba(120,220,192,.38), rgba(179,155,255,.38), rgba(255,180,138,.38))',
  },
  { id: 'red', label: 'Vermelho', style: 'background: rgba(255,99,99,.32)' },
  { id: 'orange', label: 'Laranja', style: 'background: rgba(255,160,80,.32)' },
  { id: 'yellow', label: 'Amarelo', style: 'background: rgba(255,214,90,.36)' },
  { id: 'green', label: 'Verde', style: 'background: rgba(110,210,140,.32)' },
  { id: 'blue', label: 'Azul', style: 'background: rgba(100,160,255,.32)' },
  { id: 'purple', label: 'Roxo', style: 'background: rgba(170,130,255,.34)' },
] as const

export type HighlightId = (typeof HIGHLIGHTS)[number]['id']

/** O padrão usa "==" (Markdown estendido); as cores usam <mark>, que outros apps também exibem. */
export function highlightMarkers(id: HighlightId): [string, string] {
  const h = HIGHLIGHTS.find((x) => x.id === id)
  if (!h?.style) return ['==', '==']
  return [`<mark style="${h.style}">`, '</mark>']
}

function clearInline(line: string): string {
  return line
    .replace(/<mark\b[^>]*>/gi, '')
    .replace(/<\/mark>/gi, '')
    .replace(/%%/g, '')
    .replace(/(\*\*|__|~~|==)/g, '')
    .replace(/(^|[^\\*_\p{L}\p{N}])[*_](?=\S)([^*_\n]*?\S)[*_](?![*_\p{L}\p{N}])/gu, '$1$2')
    .replace(/(?<!`)`([^`\n]+)`(?!`)/g, '$1')
    .replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, '$1$2')
}

/**
 * Remove marcadores de formatação inline, mantendo o texto. Blocos de código
 * (``` ou ~~~) e equações em bloco ($$) ficam intactos.
 */
export function clearFormatting(text: string): string {
  let fence: string | null = null
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,}|\$\$)/.exec(line)?.[1]
      if (marker) {
        if (fence === null) fence = marker.startsWith('$') ? '$$' : marker[0]!
        else if (marker.startsWith(fence[0]!)) fence = null
        return line
      }
      return fence === null ? clearInline(line) : line
    })
    .join('\n')
}

/** Próximo número livre de nota de rodapé ([^1], [^2]...). */
export function nextFootnoteNumber(doc: string): number {
  let max = 0
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]))
  return max + 1
}

/** Envolve cada seleção com abre/fecha; se já estiver envolvida, remove. */
export function toggleWrapPair(open: string, close: string): Command {
  return (view) => {
    const { state } = view
    const tr = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - open.length, range.from)
      const after = state.sliceDoc(range.to, range.to + close.length)
      if (before === open && after === close) {
        return {
          changes: [
            { from: range.from - open.length, to: range.from },
            { from: range.to, to: range.to + close.length },
          ],
          range: EditorSelection.range(range.from - open.length, range.to - open.length),
        }
      }
      return {
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        range: EditorSelection.range(range.from + open.length, range.to + open.length),
      }
    })
    view.dispatch(state.update(tr, { userEvent: 'input', scrollIntoView: true }))
    return true
  }
}

export function highlight(id: HighlightId): Command {
  const [open, close] = highlightMarkers(id)
  return toggleWrapPair(open, close)
}

/** Limpa a formatação da seleção; sem seleção, da linha inteira. */
export const clearFormattingCommand: Command = (view) => {
  const { state } = view
  const tr = state.changeByRange((range) => {
    const from = range.empty ? state.doc.lineAt(range.from).from : range.from
    const to = range.empty ? state.doc.lineAt(range.from).to : range.to
    const cleaned = clearFormatting(state.sliceDoc(from, to))
    return {
      changes: { from, to, insert: cleaned },
      range: range.empty
        ? EditorSelection.cursor(Math.min(range.from, from + cleaned.length))
        : EditorSelection.range(from, from + cleaned.length),
    }
  })
  view.dispatch(state.update(tr, { userEvent: 'input' }))
  return true
}

/** "Texto": remove título, lista, tarefa e citação do início das linhas. */
export const plainParagraph: Command = (view) => {
  const changes: Array<{ from: number; to: number }> = []
  const seen = new Set<number>()
  for (const r of view.state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = view.state.doc.lineAt(pos)
      if (!seen.has(line.number)) {
        seen.add(line.number)
        const m = /^(\s*)(#{1,6} |> ?|[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/.exec(line.text)
        if (m) changes.push({ from: line.from + m[1]!.length, to: line.from + m[0].length })
      }
      pos = line.to + 1
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input' })
  return true
}

/** Insere [^n] no cursor e a definição no fim da nota, levando o cursor até ela. */
export const insertFootnote: Command = (view) => {
  const doc = view.state.doc.toString()
  const n = nextFootnoteNumber(doc)
  const pos = view.state.selection.main.to
  const ref = `[^${n}]`
  const definition = `${doc.endsWith('\n') ? '' : '\n'}\n${ref}: `
  view.dispatch({
    changes: [
      { from: pos, insert: ref },
      { from: doc.length, insert: definition },
    ],
    selection: { anchor: doc.length + ref.length + definition.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

/** Insere um bloco numa linha própria; "$SEL" vira o texto selecionado. */
export function insertBlock(view: EditorView, block: string, cursorInBlock: number): void {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const prefix = range.from === line.from && line.text.trim() === '' ? '' : '\n\n'
  const selected = state.sliceDoc(range.from, range.to)
  const text = block.replace('$SEL', selected)
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `${prefix}${text}\n` },
    selection: { anchor: range.from + prefix.length + (selected ? text.length : cursorInBlock) },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

export const insertCallout: Command = (view) => {
  insertBlock(view, '> [!note] Título\n> $SEL', '> [!note] Título\n> '.length)
  return true
}

export const insertMathBlock: Command = (view) => {
  insertBlock(view, '$$\n$SEL\n$$', 3)
  return true
}

export const insertTable: Command = (view) => {
  insertBlock(view, '| Coluna 1 | Coluna 2 |\n| -------- | -------- |\n| $SEL | |', 2)
  return true
}

export const insertCodeBlock: Command = (view) => {
  insertBlock(view, '```\n$SEL\n```', 3)
  return true
}

export const insertRule: Command = (view) => {
  insertBlock(view, '---', 4)
  return true
}

/** Base: tabela viva de notas, definida por um filtro (veja lib/base.ts). */
export const insertBase: Command = (view) => {
  insertBlock(view, '```base\nfiltro: tag:projeto\ncolunas: [arquivo, pasta, tags]\nordenar: arquivo\n```', '```base\nfiltro: '.length)
  return true
}
