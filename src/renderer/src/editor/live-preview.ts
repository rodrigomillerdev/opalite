import { showToast } from '../lib/toast'
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

/*
 * Live preview: o texto continua sendo Markdown puro, mas os marcadores
 * (#, **, _, `, ~~) somem visualmente nas linhas onde o cursor NÃO está.
 * Na linha em edição eles reaparecem, para a pessoa ver o que está mudando.
 *
 * Funciona lendo a árvore sintática que o @codemirror/lang-markdown já
 * produz e criando "decorações": substituições visuais que não alteram o
 * documento. Por isso salvar sempre grava exatamente o que foi digitado.
 */

const hidden = Decoration.replace({})

class HorizontalRuleWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-opal-hr'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
}

const hrWidget = Decoration.replace({ widget: new HorizontalRuleWidget() })

/** Botão "copiar" no canto do bloco de código (copia só o conteúdo, sem as cercas). */
class CopyCodeWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  override eq(other: CopyCodeWidget): boolean {
    return other.code === this.code
  }
  toDOM(): HTMLElement {
    const button = document.createElement('button')
    button.className = 'cm-opal-copy'
    button.type = 'button'
    button.title = 'Copiar código'
    button.setAttribute('aria-label', 'Copiar código')
    // Dois ícones sobrepostos: copiar e "copiado". O CSS anima a troca.
    button.innerHTML =
      '<svg class="cm-opal-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
      '<svg class="cm-opal-check-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
    let timer: ReturnType<typeof setTimeout> | null = null
    button.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard
        .writeText(this.code)
        .then(() => {
          // Só confirma depois que o sistema aceitou a cópia.
          button.dataset['copied'] = 'true'
          button.title = 'Copiado'
          showToast('Copiado para a área de transferência!', { anchor: button })
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            delete button.dataset['copied']
            button.title = 'Copiar código'
          }, 1600)
        })
        .catch(() => showToast('Não foi possível copiar.', { anchor: button, kind: 'error' }))
    })
    return button
  }
  override ignoreEvent(): boolean {
    return true
  }
}


/** Caixa de tarefa clicável: alterna "[ ]" e "[x]" no próprio texto. */
class TaskWidget extends WidgetType {
  constructor(readonly done: boolean) {
    super()
  }
  override eq(other: TaskWidget): boolean {
    return other.done === this.done
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-opal-task'
    box.checked = this.done
    box.setAttribute('aria-label', this.done ? 'Tarefa concluída' : 'Tarefa pendente')
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      // pos aponta para o "[" do marcador; o caractere de estado vem logo depois.
      const current = view.state.doc.sliceString(pos + 1, pos + 2)
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: current === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle' })
    })
    return box
  }
  override ignoreEvent(): boolean {
    return true
  }
}

const taskOpen = Decoration.replace({ widget: new TaskWidget(false) })
const taskDone = Decoration.replace({ widget: new TaskWidget(true) })

/** Ponto no lugar de "-", "*" ou "+" das listas sem ordem. */
class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-opal-bullet'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() })

/** Rótulo discreto com a linguagem, no lugar da cerca de abertura ```. */
class FenceLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  override eq(other: FenceLabelWidget): boolean {
    return other.lang === this.lang
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-opal-fence-label'
    el.textContent = this.lang
    return el
  }
}

/** Números das linhas tocadas por alguma seleção ou cursor. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const active = activeLines(state)
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number)
  const decorations: Range<Decoration>[] = []

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name

        // Títulos: classe por nível na linha inteira (espaçamento e tamanho).
        const heading = /^ATXHeading(\d)$/.exec(name)
        if (heading) {
          const line = state.doc.lineAt(node.from)
          decorations.push(
            Decoration.line({ class: `cm-opal-heading cm-opal-h${heading[1]}` }).range(line.from),
          )
          return
        }

        if (name === 'HeaderMark') {
          if (node.node.parent?.name.startsWith('SetextHeading')) return
          if (isActive(node.from)) return
          const line = state.doc.lineAt(node.from)
          // Esconde também o espaço depois do "#".
          const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
          decorations.push(hidden.range(node.from, Math.min(end, line.to)))
          return
        }

        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          if (!isActive(node.from)) decorations.push(hidden.range(node.from, node.to))
          return
        }

        // Listas: o marcador vira ponto (ou some, nas tarefas) fora da linha em edição.
        if (name === 'ListMark') {
          const list = node.node.parent?.parent?.name
          const task = node.node.nextSibling?.name === 'Task'
          if (list !== 'BulletList' || isActive(node.from)) return
          if (task) {
            const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
            decorations.push(hidden.range(node.from, end))
          } else {
            decorations.push(bullet.range(node.from, node.to))
          }
          return
        }

        if (name === 'TaskMarker') {
          const done = /x/i.test(state.doc.sliceString(node.from + 1, node.to - 1))
          // Com o cursor dentro do marcador, mostra o texto cru para edição.
          const cursorInside = state.selection.ranges.some((r) => r.from <= node.to && r.to >= node.from)
          if (!cursorInside) decorations.push((done ? taskDone : taskOpen).range(node.from, node.to))
          if (done) decorations.push(Decoration.line({ class: 'cm-opal-task-done' }).range(state.doc.lineAt(node.from).from))
          return
        }

        // Crases de código inline (as de bloco cercado ficam visíveis).
        if (name === 'CodeMark' && node.node.parent?.name === 'InlineCode') {
          if (!isActive(node.from)) decorations.push(hidden.range(node.from, node.to))
          return
        }

        if (name === 'HorizontalRule') {
          if (!isActive(node.from)) decorations.push(hrWidget.range(node.from, node.to))
          return
        }

        // Blocos de código cercados: fundo contínuo, cantos arredondados nas pontas.
        if (name === 'FencedCode') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            const line = state.doc.line(n)
            let cls = 'cm-opal-codeblock'
            if (n === first) cls += ' cm-opal-codeblock-first'
            if (n === last) cls += ' cm-opal-codeblock-last'
            decorations.push(Decoration.line({ class: cls }).range(line.from))
          }
          // Fora de edição, as cercas dão lugar a um rótulo com a linguagem.
          const open = state.doc.line(first)
          const close = state.doc.line(last)
          const closed = last > first && /^\s*(```|~~~)\s*$/.test(close.text)
          if (closed && !isActive(open.from) && !isActive(close.from)) {
            const lang = open.text.replace(/^\s*(```|~~~)/, '').trim()
            decorations.push(Decoration.replace({ widget: new FenceLabelWidget(lang) }).range(open.from, open.to))
            if (close.to > close.from) decorations.push(hidden.range(close.from, close.to))
          }
          // Botão de copiar no fim da primeira linha (posicionado no canto por CSS).
          if (last > first) {
            const firstLine = state.doc.line(first)
            const code = state.doc.sliceString(firstLine.to + 1, state.doc.line(last).from).replace(/\n$/, '')
            decorations.push(Decoration.widget({ widget: new CopyCodeWidget(code), side: 1 }).range(firstLine.to))
          }
          // Não retorna false: os CodeMark internos não são escondidos (pai != InlineCode).
          return
        }

        if (name === 'Blockquote') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            decorations.push(Decoration.line({ class: 'cm-opal-quote' }).range(state.doc.line(n).from))
          }
        }
      },
    })
  }

  // `true` pede ao CodeMirror para ordenar as decorações por posição.
  return Decoration.set(decorations, true)
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
