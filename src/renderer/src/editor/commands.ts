import { EditorSelection } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/**
 * Envolve a seleção com um marcador (ex.: "**" para negrito) ou o remove se
 * ela já estiver envolvida. Sem seleção, insere o par e põe o cursor no meio.
 */
export function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view
    const size = marker.length
    const transaction = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - size, range.from)
      const after = state.sliceDoc(range.to, range.to + size)
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - size, to: range.from },
            { from: range.to, to: range.to + size },
          ],
          range: EditorSelection.range(range.from - size, range.to - size),
        }
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      }
    })
    view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}
