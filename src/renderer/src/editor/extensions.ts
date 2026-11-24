import { getSettings } from '../lib/settings'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { findNext, findPrevious, highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  placeholder,
  rectangularSelection,
} from '@codemirror/view'
import { toggleWrap } from './commands'
import { type CompletionData, createCompletion } from './completion'
import { wikilinks } from './links'
import { livePreview } from './live-preview'
import { richPreview } from './rich-preview'
import { insertMarkdownLink, toggleTask } from './markdown-commands'
import { opalEditorTheme, opalHighlight } from './theme'

export interface EditorHooks {
  onSave(): void
  completion: CompletionData
}

/** Conjunto de extensões do editor. Cada nota recebe um EditorState com estas extensões. */
export function createExtensions(hooks: EditorHooks, onUpdate: Extension): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    // Markdown com GFM (tabelas, tachado, listas de tarefas). As linguagens dos
    // blocos de código são carregadas sob demanda, só quando aparecem na nota.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(opalHighlight),
    livePreview,
    richPreview,
    wikilinks,
    createCompletion(hooks.completion),
    opalEditorTheme,
    placeholder('Comece a escrever…'),
    EditorView.contentAttributes.of({ spellcheck: String(getSettings().spellcheck), 'aria-label': 'Conteúdo da nota' }),
    // Clique direito DENTRO de uma seleção não pode desfazê-la: o menu de
    // formatação precisa agir sobre o texto selecionado.
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 2) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        return view.state.selection.ranges.some((r) => !r.empty && pos >= r.from && pos <= r.to)
      },
    }),
    keymap.of([
      { key: 'Mod-s', run: () => (hooks.onSave(), true), preventDefault: true },
      { key: 'Mod-b', run: toggleWrap('**') },
      { key: 'Mod-i', run: toggleWrap('*') },
      { key: 'Mod-Shift-x', run: toggleWrap('~~') },
      { key: 'Mod-e', run: toggleWrap('`') },
      { key: 'Mod-l', run: toggleTask },
      { key: 'Mod-k', run: insertMarkdownLink },
      ...completionKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      // Ctrl+G fica livre para a visualização em gráfico; "buscar próximo" continua no F3.
      ...searchKeymap.filter((b) => b.key !== 'Mod-g' && b.key !== 'Shift-Mod-g'),
      { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true },
      ...historyKeymap,
      indentWithTab,
    ]),
    onUpdate,
  ]
}
