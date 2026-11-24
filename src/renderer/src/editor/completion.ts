import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  autocompletion,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { NoteSummary, TagCount } from '../../../shared/types'

/*
 * Autocompletar:
 * - "[[" sugere notas (por título e apelidos);
 * - "[[Nota#" sugere os títulos daquela nota;
 * - "#" sugere tags já usadas no cofre.
 */

export interface CompletionData {
  notes(): NoteSummary[]
  tags(): TagCount[]
  linkTextFor(path: string): string
  resolve(target: string): string | null
  headings(path: string): Promise<string[]>
}

/** Insere o texto e coloca o cursor depois do "]]" (criando-o se faltar). */
function applyInsideLink(insert: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const after = view.state.sliceDoc(to, to + 2)
    const closing = after === ']]' ? '' : ']]'
    view.dispatch({
      changes: { from, to, insert: insert + closing },
      selection: { anchor: from + insert.length + 2 },
      userEvent: 'input.complete',
    })
  }
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function createCompletion(data: CompletionData) {
  async function source(ctx: CompletionContext): Promise<CompletionResult | null> {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = line.text.slice(0, ctx.pos - line.from)

    // [[Nota#título
    const heading = /\[\[([^[\]|#\n]+)#([^[\]|\n]*)$/.exec(before)
    if (heading) {
      const path = data.resolve(heading[1]!)
      if (!path) return null
      const headings = await data.headings(path)
      return {
        from: ctx.pos - heading[2]!.length,
        options: headings.map((h) => ({ label: h, type: 'text', apply: applyInsideLink(h) })),
        validFor: /^[^[\]|\n]*$/,
      }
    }

    // [[Nota
    const link = /\[\[([^[\]|#\n]*)$/.exec(before)
    if (link) {
      const options: Completion[] = []
      for (const note of data.notes()) {
        const text = data.linkTextFor(note.path)
        const folder = folderOf(note.path)
        options.push({ label: note.title, detail: folder || undefined, type: 'note', apply: applyInsideLink(text) })
        for (const alias of note.aliases) {
          options.push({
            label: alias,
            detail: `apelido de ${note.title}`,
            type: 'note',
            apply: applyInsideLink(`${text}|${alias}`),
            boost: -1,
          })
        }
      }
      return { from: ctx.pos - link[1]!.length, options, validFor: /^[^[\]|#\n]*$/ }
    }

    // #tag (exige ao menos 1 letra, para não atrapalhar "# Título")
    const tag = /(?:^|[\s(,;])#([\p{L}\p{N}_\-/]+)$/u.exec(before)
    if (tag) {
      return {
        from: ctx.pos - tag[1]!.length,
        options: data.tags().map((t) => ({ label: t.tag, detail: String(t.count), type: 'keyword' })),
        validFor: /^[\p{L}\p{N}_\-/]*$/u,
      }
    }
    return null
  }

  return autocompletion({
    override: [source],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
    maxRenderedOptions: 60,
  })
}
