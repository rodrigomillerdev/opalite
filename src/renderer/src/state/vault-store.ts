import { getSettings } from '../lib/settings'
import { create } from 'zustand'
import type { TreeNode, VaultEvent, VaultInfo } from '../../../shared/types'
import { documents } from '../editor/document-manager'
import { flushAll } from '../lib/flushers'
import { dailyNotePath, dailyNoteSettings, renderTemplate } from '../lib/daily'
import { clearBlobs, findFile, forgetBlob, isAttachment } from '../lib/attachments'
import { isWithin, join, parentOf, replacePrefix } from '../lib/paths'
import { useIndex } from './index-store'

const api = () => window.opalite

/*
 * Estado do cofre e da área de trabalho: árvore de arquivos, abas abertas,
 * histórico de navegação e as ações sobre arquivos.
 *
 * Abas: cada aba mostra uma nota, a visualização em gráfico, um canvas ou
 * fica vazia. `activePath` é a nota da aba ativa (null se a aba ativa não
 * for uma nota); painéis e comandos de edição usam esse valor.
 */

export type TabKind = 'note' | 'graph' | 'canvas' | 'file' | 'drive' | 'empty'

export interface Tab {
  id: string
  kind: TabKind
  path: string | null
}

interface OpenOptions {
  /** false = não registra no histórico (usado por Voltar/Avançar). */
  history?: boolean
  /** true = abre em uma aba nova (Ctrl+clique). */
  newTab?: boolean
}

interface VaultState {
  booting: boolean
  vault: VaultInfo | null
  recent: VaultInfo[]
  tree: TreeNode[]
  activePath: string | null
  tabs: Tab[]
  activeTabId: string
  /** Abas fechadas recentemente (Ctrl+Shift+T reabre). */
  closedTabs: Tab[]
  /** Pastas expandidas na árvore (objeto em vez de Set: mais simples de copiar). */
  expanded: Record<string, true>
  renamingPath: string | null
  sidebarOpen: boolean
  error: string | null
  /** Mensagem de sucesso passageira (ex.: "3 arquivos importados"). */
  notice: string | null
  /** Histórico de navegação (Voltar/Avançar). */
  back: string[]
  forward: string[]

  init(): Promise<void>
  pickVault(mode: 'open' | 'create'): Promise<void>
  openRecent(root: string): Promise<void>
  closeVault(): Promise<void>
  refreshTree(): Promise<void>
  openFile(path: string, options?: OpenOptions): Promise<void>
  /** Abre o destino de um [[link]]; cria a nota se ela não existir. */
  openLink(target: string, section: string | null, options?: OpenOptions): Promise<void>
  openGraph(): Promise<void>
  /** Abre o gerenciador de arquivos. */
  openDrive(): Promise<void>
  openCanvas(path: string, options?: OpenOptions): Promise<void>
  /** Abre um anexo (PDF, DOCX, imagem...) no visualizador. */
  openAttachment(path: string, options?: OpenOptions): Promise<void>
  notify(message: string): void
  createCanvas(folder?: string): Promise<void>
  openDailyNote(offsetDays?: number): Promise<void>
  newTab(): Promise<void>
  activateTab(id: string): Promise<void>
  closeTab(id?: string): Promise<void>
  reopenClosedTab(): Promise<void>
  cycleTab(step: number): Promise<void>
  moveTab(id: string, toIndex: number): void
  goBack(): Promise<void>
  goForward(): Promise<void>
  duplicate(path: string): Promise<void>
  copyLink(path: string): Promise<void>
  openRandom(): Promise<void>
  toggleFolder(path: string): void
  createNote(folder?: string): Promise<void>
  createFolder(parent?: string): Promise<void>
  startRename(path: string): void
  cancelRename(): void
  commitRename(path: string, newName: string): Promise<void>
  /** Renomeia ou move para o caminho completo `target` (links são atualizados). */
  moveEntry(path: string, target: string): Promise<void>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  toggleSidebar(): void
  handleEvents(events: VaultEvent[]): Promise<void>
  dismissError(): void
}

const tabsKey = (root: string) => `opalite:tabs:${root}`

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

let tabCounter = 0
function makeTab(kind: TabKind, path: string | null = null): Tab {
  tabCounter += 1
  return { id: `t${Date.now().toString(36)}${tabCounter}`, kind, path }
}

const isCanvasPath = (path: string) => path.toLowerCase().endsWith('.canvas')

export function treeHas(nodes: TreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.path === path) return true
    if (node.kind === 'folder' && isWithin(path, node.path) && treeHas(node.children, path)) return true
  }
  return false
}

/** Expande todas as pastas ancestrais de um caminho. */
function withAncestors(expanded: Record<string, true>, path: string): Record<string, true> {
  const next = { ...expanded }
  let dir = parentOf(path)
  while (dir) {
    next[dir] = true
    dir = parentOf(dir)
  }
  return next
}

const initialTab = makeTab('empty')

export const useVault = create<VaultState>((set, get) => {
  const activeTab = () => get().tabs.find((t) => t.id === get().activeTabId)

  /** Coloca (ou reaproveita) uma aba para `kind/path` e a ativa. */
  function placeTab(kind: TabKind, path: string | null, newTab = false): Tab {
    const { tabs } = get()
    const current = activeTab()
    const same = tabs.find((t) => t.kind === kind && t.path === path)
    const currentIsDoc = current && (current.kind === 'note' || current.kind === 'empty')
    // Gráfico e canvas têm uma aba só por arquivo; uma nota já aberta é
    // reaproveitada quando a aba atual não é de nota (ex.: clique no gráfico).
    if (same && !newTab && (kind !== 'note' || !currentIsDoc)) {
      set({ activeTabId: same.id })
      return same
    }
    // Notas abrem na aba atual quando ela é de nota ou vazia (como num navegador).
    const reuse = !newTab && current && (current.kind === 'empty' || (kind === 'note' && current.kind === 'note'))
    if (reuse && current) {
      const updated = { ...current, kind, path }
      set({ tabs: tabs.map((t) => (t.id === current.id ? updated : t)) })
      return updated
    }
    const tab = makeTab(kind, path)
    const index = current ? tabs.indexOf(current) + 1 : tabs.length
    set({ tabs: [...tabs.slice(0, index), tab, ...tabs.slice(index)], activeTabId: tab.id })
    return tab
  }

  return {
    booting: true,
    vault: null,
    recent: [],
    tree: [],
    activePath: null,
    tabs: [initialTab],
    activeTabId: initialTab.id,
    closedTabs: [],
    expanded: {},
    renamingPath: null,
    sidebarOpen: true,
    error: null,
    notice: null,
    back: [],
    forward: [],

    async init() {
      try {
        const [vault, recent] = await Promise.all([api().vault.current(), api().vault.recent()])
        set({ vault, recent })
        if (vault) await enterVault(vault)
      } catch (err) {
        set({ error: message(err) })
      } finally {
        set({ booting: false })
      }
    },

    async pickVault(mode) {
      try {
        const vault = await api().vault.pick(mode)
        if (vault) await switchTo(vault)
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async openRecent(root) {
      try {
        await switchTo(await api().vault.openRecent(root))
      } catch (err) {
        set({ error: message(err), recent: await api().vault.recent() })
      }
    },

    async closeVault() {
      await flushAll()
      documents.reset()
      clearBlobs()
      await api().vault.close()
      useIndex.getState().clear()
      const tab = makeTab('empty')
      set({
        vault: null,
        tree: [],
        activePath: null,
        tabs: [tab],
        activeTabId: tab.id,
        closedTabs: [],
        expanded: {},
        back: [],
        forward: [],
        recent: await api().vault.recent(),
      })
    },

    async refreshTree() {
      if (!get().vault) return
      try {
        set({ tree: await api().vault.tree() })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async openFile(path, options = {}) {
      if (isCanvasPath(path)) return get().openCanvas(path, options)
      if (isAttachment(path)) return get().openAttachment(path, options)
      const previous = get().activePath
      const current = activeTab()
      if (path === previous && current?.kind === 'note' && !options.newTab) return documents.focus()
      placeTab('note', path, options.newTab)
      set((s) => ({
        activePath: path,
        expanded: withAncestors(s.expanded, path),
        ...(options.history !== false && previous && previous !== path
          ? { back: [...s.back, previous].slice(-50), forward: [] }
          : {}),
      }))
      try {
        await documents.open(path)
      } catch (err) {
        set({ error: `Não foi possível abrir a nota: ${message(err)}` })
      }
    },

    async openLink(target, section, options = {}) {
      if (!target) {
        if (section) documents.revealHeading(section)
        return
      }
      try {
        // [[relatorio.pdf]] e similares apontam para anexos, não para notas.
        if (isAttachment(target)) {
          const file = findFile(get().tree, target)
          if (file) return get().openFile(file, options)
          set({ error: `Arquivo não encontrado: ${target}` })
          return
        }
        let path = useIndex.getState().resolver.resolve(target, get().activePath)
        if (!path) {
          // Como em outros editores de wikilinks: clicar num link para uma nota
          // inexistente cria a nota.
          path = await api().files.createNote(target.toLowerCase().endsWith('.md') ? target : `${target}.md`)
          await Promise.all([get().refreshTree(), useIndex.getState().refresh()])
        }
        await get().openFile(path, options)
        if (section) documents.revealHeading(section)
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async openGraph() {
      await flushAll()
      placeTab('graph', null)
      set({ activePath: null })
    },

    async openDrive() {
      await flushAll()
      placeTab('drive', null)
      set({ activePath: null })
    },

    async openCanvas(path, options = {}) {
      await flushAll()
      placeTab('canvas', path, options.newTab)
      set((s) => ({ activePath: null, expanded: withAncestors(s.expanded, path) }))
    },

    async openAttachment(path, options = {}) {
      await flushAll()
      placeTab('file', path, options.newTab)
      set((s) => ({ activePath: null, expanded: withAncestors(s.expanded, path) }))
    },

    notify(message) {
      set({ notice: message })
    },

    async createCanvas(folder) {
      const current = get().activePath ?? activeTab()?.path ?? null
      const dir = folder ?? (current ? parentOf(current) : '')
      try {
        const path = await api().files.createCanvas(join(dir, 'Sem título.canvas'))
        await get().refreshTree()
        await get().openCanvas(path, { newTab: activeTab()?.kind !== 'empty' })
        set({ renamingPath: path })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async openDailyNote(offsetDays = 0) {
      const settings = dailyNoteSettings()
      const date = new Date()
      date.setDate(date.getDate() + offsetDays)
      const path = dailyNotePath(date, settings)
      try {
        if (!treeHas(get().tree, path)) {
          let content = `# ${path.slice(path.lastIndexOf('/') + 1, -3)}\n\n`
          if (settings.template) {
            try {
              const tpl = await api().files.read(settings.template)
              content = renderTemplate(tpl.content, { title: path.slice(path.lastIndexOf('/') + 1, -3), date })
            } catch {
              // modelo não encontrado: usa o conteúdo padrão
            }
          }
          await api().files.createNote(path, content)
          await get().refreshTree()
        }
        await get().openFile(path)
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async newTab() {
      await flushAll()
      const tab = makeTab('empty')
      const { tabs } = get()
      const current = activeTab()
      const index = current ? tabs.indexOf(current) + 1 : tabs.length
      set({ tabs: [...tabs.slice(0, index), tab, ...tabs.slice(index)], activeTabId: tab.id, activePath: null })
    },

    async activateTab(id) {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || id === get().activeTabId) return
      await flushAll()
      set({ activeTabId: id, activePath: tab.kind === 'note' ? tab.path : null })
      if (tab.kind === 'note' && tab.path) {
        try {
          await documents.open(tab.path)
        } catch (err) {
          set({ error: message(err) })
        }
      }
    },

    async closeTab(id = get().activeTabId) {
      const { tabs, activeTabId } = get()
      const index = tabs.findIndex((t) => t.id === id)
      if (index === -1) return
      const closing = tabs[index]!
      const rest = tabs.filter((t) => t.id !== id)
      set((s) => ({ closedTabs: closing.kind === 'empty' ? s.closedTabs : [...s.closedTabs, closing].slice(-20) }))
      if (rest.length === 0) {
        await documents.close()
        const tab = makeTab('empty')
        set({ tabs: [tab], activeTabId: tab.id, activePath: null })
        return
      }
      set({ tabs: rest })
      if (id === activeTabId) {
        const next = rest[Math.min(index, rest.length - 1)]!
        set({ activeTabId: '' })
        await get().activateTab(next.id)
      }
    },

    async reopenClosedTab() {
      const closed = [...get().closedTabs]
      const tab = closed.pop()
      if (!tab) return
      set({ closedTabs: closed })
      if (tab.kind === 'graph') return get().openGraph()
      if (tab.kind === 'drive') return get().openDrive()
      if (tab.path && treeHas(get().tree, tab.path)) {
        if (tab.kind === 'canvas') return get().openCanvas(tab.path, { newTab: true })
        if (tab.kind === 'file') return get().openAttachment(tab.path, { newTab: true })
        return get().openFile(tab.path, { newTab: true })
      }
    },

    async cycleTab(step) {
      const { tabs, activeTabId } = get()
      if (tabs.length < 2) return
      const index = tabs.findIndex((t) => t.id === activeTabId)
      const next = tabs[(index + step + tabs.length) % tabs.length]!
      await get().activateTab(next.id)
    },

    moveTab(id, toIndex) {
      const tabs = [...get().tabs]
      const from = tabs.findIndex((t) => t.id === id)
      if (from === -1) return
      const [tab] = tabs.splice(from, 1)
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab!)
      set({ tabs })
    },

    async goBack() {
      const { back, activePath, tree } = get()
      // Pula notas que deixaram de existir.
      const stack = back.filter((p) => treeHas(tree, p))
      const target = stack.pop()
      if (!target) return
      set((s) => ({ back: stack, forward: activePath ? [activePath, ...s.forward] : s.forward }))
      await get().openFile(target, { history: false })
    },

    async goForward() {
      const { forward, activePath, tree } = get()
      const stack = forward.filter((p) => treeHas(tree, p))
      const target = stack.shift()
      if (!target) return
      set((s) => ({ forward: stack, back: activePath ? [...s.back, activePath] : s.back }))
      await get().openFile(target, { history: false })
    },

    async duplicate(path) {
      try {
        await flushAll()
        const { content } = await api().files.read(path)
        const copy = isCanvasPath(path)
          ? await api().files.createCanvas(path).then(async (p) => (await api().files.write(p, content), p))
          : await api().files.createNote(path, content)
        await get().refreshTree()
        await get().openFile(copy)
        set({ renamingPath: copy })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async copyLink(path) {
      const text = `[[${useIndex.getState().resolver.linkTextFor(path)}]]`
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        set({ error: 'Não foi possível copiar para a área de transferência.' })
      }
    },

    async openRandom() {
      const notes = useIndex.getState().notes.filter((n) => n.path !== get().activePath)
      const pick = notes[Math.floor(Math.random() * notes.length)]
      if (pick) await get().openFile(pick.path)
    },

    toggleFolder(path) {
      set((s) => {
        const expanded = { ...s.expanded }
        if (expanded[path]) delete expanded[path]
        else expanded[path] = true
        return { expanded }
      })
    },

    async createNote(folder) {
      const current = get().activePath ?? activeTab()?.path ?? null
      const dir = folder ?? (current && getSettings().newNoteLocation === 'current' ? parentOf(current) : '')
      try {
        const path = await api().files.createNote(join(dir, 'Sem título.md'))
        await get().refreshTree()
        await get().openFile(path)
        set({ renamingPath: path })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async createFolder(parent = '') {
      try {
        const path = await api().files.createFolder(join(parent, 'Nova pasta'))
        set((s) => ({ expanded: withAncestors(s.expanded, join(path, 'x')) }))
        await get().refreshTree()
        set({ renamingPath: path })
      } catch (err) {
        set({ error: message(err) })
      }
    },

    startRename(path) {
      set({ renamingPath: path })
    },

    cancelRename() {
      set({ renamingPath: null })
    },

    async commitRename(path, newName) {
      set({ renamingPath: null })
      const name = newName.trim()
      if (!name) return
      // O processo principal acrescenta a extensão (.md ou .canvas) se faltar.
      const target = join(parentOf(path), name)
      if (target === path || `${target}.md` === path || `${target}.canvas` === path) return
      await get().moveEntry(path, target)
    },

    async moveEntry(path, target) {
      if (target === path) return
      try {
        // Salva antes: um save atrasado no caminho antigo recriaria o arquivo.
        await flushAll()
        const final = await api().files.rename(path, target)
        documents.renamed(path, final)
        window.dispatchEvent(new CustomEvent('opalite:moved', { detail: { from: path, to: final } }))
        const move = (p: string | null) => (p && isWithin(p, path) ? replacePrefix(p, path, final) : p)
        set((s) => {
          const expanded: Record<string, true> = {}
          for (const key of Object.keys(s.expanded)) expanded[move(key)!] = true
          return {
            expanded,
            activePath: move(s.activePath),
            tabs: s.tabs.map((t) => ({ ...t, path: move(t.path) })),
            back: s.back.map((p) => move(p)!),
            forward: s.forward.map((p) => move(p)!),
          }
        })
        await get().refreshTree()
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async trash(path) {
      try {
        await flushAll()
        const done = await api().files.trash(path)
        if (!done) return
        documents.deleted(path)
        window.dispatchEvent(new CustomEvent('opalite:deleted', { detail: { path } }))
        await get().refreshTree()
        await closeTabsWithin(path)
      } catch (err) {
        set({ error: message(err) })
      }
    },

    async reveal(path) {
      try {
        await api().files.reveal(path)
      } catch (err) {
        set({ error: message(err) })
      }
    },

    toggleSidebar() {
      set((s) => ({ sidebarOpen: !s.sidebarOpen }))
    },

    async handleEvents(events) {
      // Fica só o último evento de cada caminho: "unlink" seguido de "add"
      // (comum em saves atômicos de outros editores) vira apenas "add".
      const last = new Map<string, VaultEvent['type']>()
      for (const e of events) last.set(e.path, e.type)

      const structural = [...last.values()].some((t) => t !== 'change')
      if (structural) await get().refreshTree()

      for (const [path, type] of last) {
        if (type === 'change' || type === 'add') {
          if (isAttachment(path)) forgetBlob(path)
          if (path.toLowerCase().endsWith('.md')) await documents.externalChange(path)
        } else if ((type === 'unlink' || type === 'unlinkDir') && !treeHas(get().tree, path)) {
          // Apagado por fora: com edição pendente, o editor recria o arquivo.
          if (!documents.deleted(path, { external: true })) await closeTabsWithin(path)
        }
      }
    },

    dismissError() {
      set({ error: null, notice: null })
    },
  }
})

/** Fecha as abas cujo arquivo foi apagado (ou está dentro da pasta apagada). */
async function closeTabsWithin(path: string): Promise<void> {
  const { tabs, closeTab } = useVault.getState()
  for (const tab of tabs) {
    if (tab.path && isWithin(tab.path, path)) await closeTab(tab.id)
  }
}

// Lembra as abas de cada cofre entre aberturas do app.
useVault.subscribe((state, prev) => {
  if (!state.vault || (state.tabs === prev.tabs && state.activeTabId === prev.activeTabId)) return
  try {
    const saved = { tabs: state.tabs.map(({ kind, path }) => ({ kind, path })), active: state.tabs.findIndex((t) => t.id === state.activeTabId) }
    localStorage.setItem(tabsKey(state.vault.root), JSON.stringify(saved))
  } catch {
    // sem armazenamento: as abas só não serão lembradas
  }
})

/** Troca de cofre: salva a nota atual, limpa o editor e entra no novo. */
async function switchTo(vault: VaultInfo): Promise<void> {
  await flushAll()
  documents.reset()
  clearBlobs()
  useIndex.getState().clear()
  const tab = makeTab('empty')
  useVault.setState({ vault, tree: [], activePath: null, tabs: [tab], activeTabId: tab.id, closedTabs: [], expanded: {}, back: [], forward: [] })
  await enterVault(vault)
  useVault.setState({ recent: await api().vault.recent() })
}

async function enterVault(vault: VaultInfo): Promise<void> {
  const { refreshTree } = useVault.getState()
  await refreshTree()
  const tree = useVault.getState().tree
  let saved: { tabs: Array<{ kind: TabKind; path: string | null }>; active: number } | null = null
  try {
    saved = JSON.parse(localStorage.getItem(tabsKey(vault.root)) ?? 'null')
  } catch {
    saved = null
  }
  const tabs = (saved?.tabs ?? [])
    .filter((t) => ['note', 'graph', 'canvas', 'file', 'drive', 'empty'].includes(t.kind))
    .filter((t) => !t.path || treeHas(tree, t.path))
    .map((t) => makeTab(t.kind, t.path))
  if (tabs.length === 0) return
  const active = tabs[Math.min(Math.max(saved?.active ?? 0, 0), tabs.length - 1)]!
  useVault.setState({ tabs, activeTabId: '' })
  await useVault.getState().activateTab(active.id)
}
