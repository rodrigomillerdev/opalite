import { Annotation, EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { isWithin, replacePrefix } from '../lib/paths'
import { countChars, countWords } from '../lib/text-stats'
import { type SaveState, useEditorStatus } from '../state/editor-status'
import { parseNote } from '../../../shared/markdown/parse'
import { frontmatterLength, setFrontmatter } from '../lib/frontmatter-edit'
import { useIndex } from '../state/index-store'
import { createExtensions } from './extensions'
import { notesChanged } from './links'
import { notify, registerFlusher } from '../lib/flushers'

/** Marca transações que vieram do disco (não devem disparar salvamento). */
const fromDisk = Annotation.define<boolean>()

const SAVE_DELAY_MS = 700
const STATS_DELAY_MS = 200
const CACHE_LIMIT = 24

interface CachedDoc {
  state: EditorState
  saved: string
  /** Edição local ainda não salva: nunca é descartada pelo limite do cache. */
  dirty: boolean
  /** Versão do disco que chegou enquanto havia edição local (conflito pendente). */
  conflictDisk: string | null
}

/**
 * Dono do editor fora do React. Cuida de:
 * - abrir notas (mantendo desfazer/refazer de cada uma ao trocar de nota);
 * - salvamento automático com debounce e Ctrl+S;
 * - mudanças externas: recarrega se não houver edição local, avisa se houver.
 *
 * Ficar fora do React evita re-renderizações a cada tecla: o CodeMirror já
 * gerencia o próprio DOM de forma muito eficiente.
 */
export class DocumentManager {
  private view: EditorView | null = null
  private path: string | null = null
  /** Último conteúdo que sabemos estar no disco para a nota aberta. */
  private saved = ''
  /**
   * Conflito: o arquivo mudou no disco enquanto havia edição local. Enquanto
   * não for resolvido, o salvamento automático fica BLOQUEADO para não apagar
   * a versão de fora (ex.: editada em outro computador via OneDrive).
   */
  private conflictDisk: string | null = null
  /** Conteúdo sendo gravado agora (para reconhecer o eco do próprio save). */
  private inFlight: string | null = null
  private dirty = false
  private cache = new Map<string, CachedDoc>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private statsTimer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> | null = null
  private openSeq = 0
  /** Estado aguardando o editor ser montado. */
  private pending: EditorState | null = null
  private readonly extensions: Extension[]

  constructor() {
    this.extensions = createExtensions(
      {
        onSave: () => void this.flush(),
        completion: {
          notes: () => useIndex.getState().notes,
          tags: () => useIndex.getState().tags,
          linkTextFor: (path) => useIndex.getState().resolver.linkTextFor(path),
          resolve: (target) => useIndex.getState().resolver.resolve(target, this.path),
          headings: (path) => window.opalite.index.headings(path),
        },
      },
      EditorView.updateListener.of((update) => this.onUpdate(update)),
    )
    registerFlusher(() => this.flush())
  }

  get currentPath(): string | null {
    return this.path
  }

  /** Acesso ao CodeMirror para comandos de edição (pode ser null). */
  get editorView(): EditorView | null {
    return this.path ? this.view : null
  }

  /** Texto atual da nota aberta (inclui o que ainda não foi salvo). */
  get text(): string {
    return (this.view?.state ?? this.pending)?.doc.toString() ?? ''
  }

  /** Redesenha os links (ex.: uma nota passou a existir). */
  refreshLinks(): void {
    this.view?.dispatch({ effects: notesChanged.of(null) })
  }

  /** Altera chaves do frontmatter da nota aberta (pode ser desfeito com Ctrl+Z). */
  updateFrontmatter(updates: Record<string, string | null>): void {
    const view = this.view
    if (!view || !this.path) return
    const text = view.state.doc.toString()
    const next = setFrontmatter(text, updates)
    if (next === text) return
    // Troca só o bloco do topo: o resto da nota (e o cursor) não se mexe.
    const oldLen = frontmatterLength(text)
    const newLen = frontmatterLength(next)
    const bodyShift = text.length - oldLen === next.length - newLen
    view.dispatch(
      bodyShift
        ? { changes: { from: 0, to: oldLen, insert: next.slice(0, newLen) }, userEvent: 'input' }
        : { changes: { from: 0, to: text.length, insert: next }, userEvent: 'input' },
    )
    this.updateStats()
  }

  /** Avisa quando o editor rola (a capa acompanha). */
  onScroll(listener: (top: number) => void): () => void {
    const dom = this.view?.scrollDOM
    if (!dom) return () => undefined
    const handler = () => listener(dom.scrollTop)
    dom.addEventListener('scroll', handler, { passive: true })
    return () => dom.removeEventListener('scroll', handler)
  }

  /** Move o cursor para o início de uma linha (0-based) e rola até ela. */
  revealLine(line: number): void {
    const view = this.view
    if (!view) return
    const target = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines))
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 80 }),
    })
    view.focus()
  }

  /** Vai até o título com esse texto (usado por [[Nota#Seção]]). */
  revealHeading(text: string): void {
    const wanted = text.trim().toLowerCase()
    const heading = parseNote(this.text).headings.find((h) => h.text.toLowerCase() === wanted)
    if (heading) this.revealLine(heading.line)
  }

  attach(parent: HTMLElement): void {
    this.view?.destroy()
    // Uma nota pode ter sido aberta antes de o editor existir na tela.
    this.view = new EditorView({ parent, state: this.pending ?? this.createState('') })
    this.pending = null
    this.updateStats()
  }

  detach(): void {
    if (!this.view) return
    // Guarda o estado: o React (StrictMode) pode desmontar e remontar o editor.
    this.pending = this.view.state
    this.view.destroy()
    this.view = null
  }

  focus(): void {
    this.view?.focus()
  }

  async open(path: string): Promise<void> {
    const seq = ++this.openSeq
    if (path === this.path) return this.focus()
    await this.flush()
    this.stash()

    let entry = this.cache.get(path)
    if (!entry) {
      const file = await window.opalite.files.read(path)
      // Cursor começa depois do frontmatter: as propriedades ficam recolhidas.
      entry = {
        state: this.createState(file.content, EditorSelection.single(frontmatterLength(file.content))),
        saved: file.content,
        dirty: false,
        conflictDisk: null,
      }
    }
    // Se a pessoa clicou em outra nota enquanto esta carregava, desiste.
    if (seq !== this.openSeq) return
    this.cache.delete(path)

    this.path = path
    this.saved = entry.saved
    this.dirty = entry.dirty || entry.state.doc.toString() !== entry.saved
    this.conflictDisk = entry.conflictDisk
    if (this.view) this.view.setState(entry.state)
    else this.pending = entry.state
    this.setStatus(this.conflictDisk !== null ? 'conflict' : this.dirty ? 'dirty' : 'saved')
    this.updateStats()
    this.focus()
  }

  /** Fecha a nota atual (salvando antes). */
  async close(): Promise<void> {
    this.openSeq++
    await this.flush()
    this.stash()
    this.clearCurrent()
  }

  /** Salva imediatamente o que estiver pendente. */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.saving) await this.saving
    if (this.conflictDisk !== null) return
    if (this.path && this.dirty && this.view) await this.save()
  }

  get hasConflict(): boolean {
    return this.conflictDisk !== null
  }

  /**
   * Resolve o conflito:
   * - 'mine': grava a versão do editor por cima do disco;
   * - 'disk': descarta a edição local e carrega a versão do disco;
   * - 'copy': guarda a versão local numa nota nova e carrega a do disco.
   */
  async resolveConflict(choice: 'mine' | 'disk' | 'copy'): Promise<string | null> {
    const view = this.view
    const disk = this.conflictDisk
    if (!view || !this.path || disk === null) return null
    this.conflictDisk = null
    if (choice === 'mine') {
      this.dirty = true
      await this.save()
      return null
    }
    let copyPath: string | null = null
    if (choice === 'copy') {
      const name = this.path.replace(/\.md$/i, '') + ' (minha versão).md'
      copyPath = await window.opalite.files.createNote(name, view.state.doc.toString())
    }
    const head = Math.min(view.state.selection.main.head, disk.length)
    view.setState(this.createState(disk, EditorSelection.single(head)))
    this.saved = disk
    this.dirty = false
    this.setStatus('saved')
    this.updateStats()
    return copyPath
  }

  /** O arquivo mudou no disco (outro programa, sincronização ou o próprio save). */
  async externalChange(path: string): Promise<void> {
    if (path !== this.path) {
      this.cache.delete(path) // versão em cache ficou velha
      return
    }
    let content: string
    try {
      content = (await window.opalite.files.read(path)).content
    } catch {
      return // o arquivo pode ter sumido; o evento de remoção cuidará disso
    }
    const view = this.view
    if (path !== this.path || !view) return
    if (content === this.saved || content === this.inFlight) return // eco do nosso save

    const current = view.state.doc.toString()
    if (content === current) {
      this.saved = content
      this.dirty = false
      this.setStatus('saved')
      return
    }
    if (this.dirty) {
      // Há edição local não salva: não descartamos o trabalho da pessoa, e
      // também não sobrescrevemos a versão de fora até alguém decidir.
      this.conflictDisk = content
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.setStatus('conflict')
      return
    }
    // Recarrega preservando a posição do cursor (limitada ao novo tamanho).
    const head = Math.min(view.state.selection.main.head, content.length)
    view.setState(this.createState(content, EditorSelection.single(head)))
    this.saved = content
    this.setStatus('saved')
    this.updateStats()
  }

  /** Um arquivo ou pasta foi renomeado/movido. */
  renamed(from: string, to: string): void {
    for (const [key, entry] of [...this.cache]) {
      if (isWithin(key, from)) {
        this.cache.delete(key)
        this.cache.set(replacePrefix(key, from, to), entry)
      }
    }
    if (this.path && isWithin(this.path, from)) this.path = replacePrefix(this.path, from, to)
  }

  /**
   * Um arquivo ou pasta foi apagado. Pelo app (lixeira), descarta. Por fora
   * (sincronização, git) e com edição não salva, recria o arquivo com a
   * versão do editor em vez de perder o trabalho. Devolve true se manteve.
   */
  deleted(path: string, options: { external?: boolean } = {}): boolean {
    for (const key of [...this.cache.keys()]) if (isWithin(key, path)) this.cache.delete(key)
    if (!this.path || !isWithin(this.path, path)) return false
    if (options.external && this.dirty && this.view) {
      const keep = this.path
      const content = this.view.state.doc.toString()
      this.conflictDisk = null
      void window.opalite.files
        .write(keep, content)
        .then(() => {
          this.saved = content
          this.dirty = false
          this.setStatus('saved')
          notify(`"${keep.slice(keep.lastIndexOf('/') + 1, -3)}" foi apagada fora do Opalite; suas alterações não salvas foram mantidas.`)
        })
        .catch(() => undefined)
      return true
    }
    this.openSeq++
    this.clearCurrent()
    return false
  }

  /** Esquece tudo (ao fechar o cofre). */
  reset(): void {
    this.openSeq++
    this.cache.clear()
    this.clearCurrent()
  }

  // ---------------------------------------------------------------- internos

  private createState(doc: string, selection?: EditorSelection): EditorState {
    return EditorState.create({ doc, extensions: this.extensions, ...(selection ? { selection } : {}) })
  }

  private onUpdate(update: ViewUpdate): void {
    if (!update.docChanged) return
    this.scheduleStats()
    if (!this.path || update.transactions.some((tr) => tr.annotation(fromDisk))) return
    if (!this.dirty) {
      this.dirty = true
      if (this.conflictDisk === null) this.setStatus('dirty')
    }
    if (this.conflictDisk !== null) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DELAY_MS)
  }

  private async save(): Promise<void> {
    const view = this.view
    const path = this.path
    if (!view || !path) return
    const content = view.state.doc.toString()
    this.inFlight = content
    this.setStatus('saving')
    this.saving = window.opalite.files
      .write(path, content)
      .then(() => {
        if (this.path !== path) return
        this.saved = content
        this.dirty = this.view?.state.doc.toString() !== content
        this.setStatus(this.dirty ? 'dirty' : 'saved')
        if (this.dirty) this.onUpdateAfterSave()
      })
      .catch((err: unknown) => {
        this.setStatus('error', err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        this.inFlight = null
        this.saving = null
      })
    await this.saving
  }

  /** A pessoa digitou durante o save: agenda outro. */
  private onUpdateAfterSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DELAY_MS)
  }

  private stash(): void {
    const state = this.view?.state ?? this.pending
    if (!this.path || !state) return
    this.cache.set(this.path, { state, saved: this.saved, dirty: this.dirty, conflictDisk: this.conflictDisk })
    // Descarta as entradas mais antigas, mas nunca uma com edição não salva.
    for (const [key, entry] of this.cache) {
      if (this.cache.size <= CACHE_LIMIT) break
      if (!entry.dirty && entry.conflictDisk === null) this.cache.delete(key)
    }
  }

  private clearCurrent(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.path = null
    this.saved = ''
    this.dirty = false
    this.conflictDisk = null
    this.pending = null
    this.view?.setState(this.createState(''))
    this.setStatus('idle')
    useEditorStatus.setState({ words: 0, chars: 0, headings: [], links: [], frontmatter: {} })
  }

  private setStatus(saveState: SaveState, error: string | null = null): void {
    useEditorStatus.setState({ saveState, error })
  }

  private scheduleStats(): void {
    if (this.statsTimer) clearTimeout(this.statsTimer)
    this.statsTimer = setTimeout(() => this.updateStats(), STATS_DELAY_MS)
  }

  /** Contagens e estrutura (títulos, links) da nota, para a barra de status e os painéis. */
  private updateStats(): void {
    const text = this.path ? this.text : ''
    const parsed = parseNote(text)
    const prev = useEditorStatus.getState()
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
    useEditorStatus.setState({
      words: countWords(text.slice(parsed.bodyStart)),
      chars: countChars(text),
      headings: same(prev.headings, parsed.headings) ? prev.headings : parsed.headings,
      links: same(prev.links.map((l) => [l.target, l.line]), parsed.links.map((l) => [l.target, l.line])) ? prev.links : parsed.links,
      frontmatter: same(prev.frontmatter, parsed.frontmatter) ? prev.frontmatter : parsed.frontmatter,
    })
  }

}

/** Instância única usada pelo app. */
export const documents = new DocumentManager()
