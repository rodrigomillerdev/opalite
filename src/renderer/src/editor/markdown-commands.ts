import { EditorSelection, type Line } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

// Comandos de formatação por linha. Todos funcionam com várias seleções e
// em várias linhas ao mesmo tempo, e podem ser desfeitos com Ctrl+Z.

/** Linhas tocadas pelas seleções, sem repetição. */
function selectedLines(view: EditorView): Line[] {
  const seen = new Set<number>()
  const lines: Line[] = []
  for (const r of view.state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = view.state.doc.lineAt(pos)
      if (!seen.has(line.number)) {
        seen.add(line.number)
        lines.push(line)
      }
      pos = line.to + 1
    }
  }
  return lines
}

/** Aplica `transform` ao prefixo de cada linha selecionada. */
function editLinePrefixes(view: EditorView, transform: (text: string) => string): boolean {
  const changes = selectedLines(view).flatMap((line) => {
    const next = transform(line.text)
    if (next === line.text) return []
    // Troca só o começo diferente, para o cursor não pular.
    let common = 0
    while (common < next.length && common < line.text.length && next[common] === line.text[common]) common++
    let tail = 0
    while (
      tail < next.length - common &&
      tail < line.text.length - common &&
      next[next.length - 1 - tail] === line.text[line.text.length - 1 - tail]
    )
      tail++
    return [{ from: line.from + common, to: line.to - tail, insert: next.slice(common, next.length - tail) }]
  })
  if (changes.length === 0) return true
  view.dispatch({ changes, userEvent: 'input', scrollIntoView: true })
  return true
}

const INDENT = /^(\s*)/
const TASK = /^(\s*)([-*+]) \[( |x|X)\] /
const BULLET = /^(\s*)([-*+]) (?!\[[ xX]\] )/
const NUMBERED = /^(\s*)(\d+)[.)] /
const QUOTE = /^(\s*)> ?/
const HEADING = /^(#{1,6}) /

/** Ctrl+L: sem lista -> "- [ ] "; "- [ ]" <-> "- [x]"; marcador simples vira tarefa. */
export const toggleTask: Command = (view) =>
  editLinePrefixes(view, (text) => {
    const task = TASK.exec(text)
    if (task) {
      const done = task[3] === ' ' ? 'x' : ' '
      return text.replace(TASK, `${task[1]}${task[2]} [${done}] `)
    }
    if (BULLET.test(text)) return text.replace(BULLET, '$1$2 [ ] ')
    if (NUMBERED.test(text)) return text.replace(NUMBERED, '$1- [ ] ')
    const indent = INDENT.exec(text)![1]!
    return `${indent}- [ ] ${text.slice(indent.length)}`
  })

export const toggleBullet: Command = (view) =>
  editLinePrefixes(view, (text) => {
    if (TASK.test(text)) return text.replace(TASK, '$1')
    if (BULLET.test(text)) return text.replace(BULLET, '$1')
    if (NUMBERED.test(text)) return text.replace(NUMBERED, '$1- ')
    const indent = INDENT.exec(text)![1]!
    return `${indent}- ${text.slice(indent.length)}`
  })

export const toggleNumbered: Command = (view) => {
  let n = 0
  return editLinePrefixes(view, (text) => {
    if (NUMBERED.test(text)) return text.replace(NUMBERED, '$1')
    n++
    const cleaned = text.replace(TASK, '$1').replace(BULLET, '$1')
    const indent = INDENT.exec(cleaned)![1]!
    return `${indent}${n}. ${cleaned.slice(indent.length)}`
  })
}

export const toggleQuote: Command = (view) => {
  const lines = selectedLines(view)
  const allQuoted = lines.every((l) => QUOTE.test(l.text) || l.text.trim() === '')
  return editLinePrefixes(view, (text) => (allQuoted ? text.replace(QUOTE, '$1') : `> ${text}`))
}

/** Define o nível do título (0 remove). Repetir o mesmo nível também remove. */
export function setHeading(level: number): Command {
  return (view) =>
    editLinePrefixes(view, (text) => {
      const current = HEADING.exec(text)
      const body = text.replace(HEADING, '')
      if (level === 0 || current?.[1]!.length === level) return body
      return `${'#'.repeat(level)} ${body}`
    })
}

/** Insere texto no cursor (substitui a seleção) e posiciona o cursor. */
export function insertText(view: EditorView, text: string, cursorOffset = text.length): void {
  const tr = view.state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: text },
    range: EditorSelection.cursor(range.from + cursorOffset),
  }))
  view.dispatch(view.state.update(tr, { userEvent: 'input', scrollIntoView: true }))
  view.focus()
}

/** Ctrl+K: [seleção](url). Sem seleção, insere o modelo com o cursor no texto. */
export const insertMarkdownLink: Command = (view) => {
  const tr = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to)
    if (/^https?:\/\/\S+$/.test(selected)) {
      return { changes: { from: range.from, to: range.to, insert: `[](${selected})` }, range: EditorSelection.cursor(range.from + 1) }
    }
    const insert = `[${selected}]()`
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length - 1) }
  })
  view.dispatch(view.state.update(tr, { userEvent: 'input', scrollIntoView: true }))
  return true
}

/** Insere "[[" "]]" em volta da seleção e abre o autocompletar de notas. */
export const insertWikilink: Command = (view) => {
  const tr = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `[[${selected}]]` },
      range: EditorSelection.range(range.from + 2, range.from + 2 + selected.length),
    }
  })
  view.dispatch(view.state.update(tr, { userEvent: 'input', scrollIntoView: true }))
  return true
}
