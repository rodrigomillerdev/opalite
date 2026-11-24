import { useFavorites } from '../state/favorites-store'
import type { Command as CmCommand } from '@codemirror/view'
import { toggleWrap } from '../editor/commands'
import { documents } from '../editor/document-manager'
import {
  insertMarkdownLink,
  insertText,
  insertWikilink,
  setHeading,
  toggleBullet,
  toggleNumbered,
  toggleQuote,
  toggleTask,
} from '../editor/markdown-commands'
import {
  HIGHLIGHTS,
  clearFormattingCommand,
  highlight,
  insertBase,
  insertCallout,
  insertCodeBlock,
  insertFootnote,
  insertMathBlock,
  insertRule,
  insertTable,
  plainParagraph,
  toggleWrapPair,
} from '../editor/format'
import { openSearchPanel, replaceNext } from '@codemirror/search'
import { redo, selectAll, undo } from '@codemirror/commands'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import { applyTheme, loadTheme, nextTheme } from './theme'

/*
 * Registro central de comandos. A paleta (Ctrl+P) lista todos; os atalhos
 * globais são resolvidos aqui. Atalhos de edição (Ctrl+B etc.) são tratados
 * pelo próprio CodeMirror e aparecem aqui só para exibição ("editorKey").
 */

export interface AppCommand {
  id: string
  name: string
  /** Atalho global, ex.: "Mod+Shift+F". "Mod" = Ctrl no Windows/Linux, Cmd no macOS. */
  hotkey?: string
  /** Atalho tratado pelo editor; só exibido na paleta. */
  editorKey?: string
  /** Se false, o comando fica oculto na paleta. */
  available?(): boolean
  run(): void | Promise<void>
}

const hasNote = () => useVault.getState().activePath !== null

function editor(cmd: CmCommand): () => void {
  return () => {
    const view = documents.editorView
    if (!view) return
    cmd(view)
    view.focus()
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function showLeft(): void {
  if (!useVault.getState().sidebarOpen) useVault.getState().toggleSidebar()
}

export const COMMANDS: AppCommand[] = [
  // Navegação
  {
    id: 'toggle-favorite',
    name: 'Adicionar/remover dos favoritos',
    run: () => {
      const path = useVault.getState().tabs.find((t) => t.id === useVault.getState().activeTabId)?.path
      if (path) useFavorites.getState().toggle(path)
    },
  },
  {
    id: 'file-history',
    name: 'Histórico de versões do arquivo atual',
    run: () => {
      const path = useVault.getState().tabs.find((t) => t.id === useVault.getState().activeTabId)?.path
      if (path) useWorkspace.getState().openHistory(path)
    },
  },
  { id: 'open-drive', name: 'Abrir gerenciador de arquivos', hotkey: 'Mod+Shift+E', run: () => void useVault.getState().openDrive() },
  { id: 'theme-studio', name: 'Abrir estúdio de temas', run: () => useWorkspace.getState().openModal('studio') },
  { id: 'zoom-in', name: 'Aumentar zoom', hotkey: 'Mod+=', run: () => void import('./zoom').then((z) => z.zoom(1)) },
  { id: 'zoom-out', name: 'Diminuir zoom', hotkey: 'Mod+-', run: () => void import('./zoom').then((z) => z.zoom(-1)) },
  { id: 'zoom-reset', name: 'Zoom padrão (100%)', hotkey: 'Mod+0', run: () => void import('./zoom').then((z) => z.zoom(0)) },
  { id: 'settings', name: 'Abrir configurações', hotkey: 'Mod+,', run: () => useWorkspace.getState().openModal('settings') },
  { id: 'palette', name: 'Abrir paleta de comandos', hotkey: 'Mod+P', run: () => useWorkspace.getState().openModal('palette') },
  { id: 'switcher', name: 'Abrir troca rápida de notas', hotkey: 'Mod+O', run: () => useWorkspace.getState().openModal('switcher') },
  {
    id: 'search',
    name: 'Buscar em todas as notas',
    hotkey: 'Mod+Shift+F',
    run: () => {
      showLeft()
      useWorkspace.getState().search()
    },
  },
  { id: 'back', name: 'Navegar para trás', hotkey: 'Mod+Alt+ArrowLeft', run: () => useVault.getState().goBack() },
  { id: 'forward', name: 'Navegar para frente', hotkey: 'Mod+Alt+ArrowRight', run: () => useVault.getState().goForward() },
  { id: 'random', name: 'Abrir nota aleatória', run: () => useVault.getState().openRandom() },
  { id: 'graph', name: 'Abrir visualização em gráfico', hotkey: 'Mod+G', run: () => useVault.getState().openGraph() },
  { id: 'local-graph', name: 'Abrir gráfico local', run: () => useWorkspace.getState().setRightTab('graph') },
  { id: 'new-canvas', name: 'Criar novo canvas', run: () => useVault.getState().createCanvas() },
  { id: 'daily', name: 'Abrir nota diária de hoje', run: () => useVault.getState().openDailyNote() },
  { id: 'daily-prev', name: 'Abrir nota diária de ontem', run: () => useVault.getState().openDailyNote(-1) },
  { id: 'daily-next', name: 'Abrir nota diária de amanhã', run: () => useVault.getState().openDailyNote(1) },
  { id: 'calendar', name: 'Abrir calendário', run: () => useWorkspace.getState().setRightTab('calendar') },
  { id: 'converter', name: 'Converter PDF ⇄ DOCX', run: () => useWorkspace.getState().openConverter() },
  { id: 'template', name: 'Inserir modelo', available: hasNote, run: () => useWorkspace.getState().openModal('template') },

  // Abas
  { id: 'new-tab', name: 'Nova aba', hotkey: 'Mod+T', run: () => useVault.getState().newTab() },
  { id: 'close-tab', name: 'Fechar aba atual', hotkey: 'Mod+W', run: () => useVault.getState().closeTab() },
  { id: 'reopen-tab', name: 'Reabrir aba fechada', hotkey: 'Mod+Shift+T', run: () => useVault.getState().reopenClosedTab() },
  { id: 'next-tab', name: 'Ir para a próxima aba', hotkey: 'Mod+Tab', run: () => useVault.getState().cycleTab(1) },
  { id: 'prev-tab', name: 'Ir para a aba anterior', hotkey: 'Mod+Shift+Tab', run: () => useVault.getState().cycleTab(-1) },
  {
    id: 'close-others',
    name: 'Fechar as outras abas',
    run: async () => {
      const { tabs, activeTabId, closeTab } = useVault.getState()
      for (const t of tabs) if (t.id !== activeTabId) await closeTab(t.id)
    },
  },

  // Arquivos
  { id: 'new-note', name: 'Criar nova nota', hotkey: 'Mod+N', run: () => useVault.getState().createNote() },
  { id: 'new-folder', name: 'Criar nova pasta', hotkey: 'Mod+Shift+N', run: () => useVault.getState().createFolder() },
  { id: 'save', name: 'Salvar nota atual', editorKey: 'Mod+S', available: hasNote, run: () => documents.flush() },
  {
    id: 'rename',
    name: 'Renomear nota',
    hotkey: 'F2',
    available: hasNote,
    run: () => {
      const s = useVault.getState()
      if (!s.activePath) return
      showLeft()
      useWorkspace.getState().setLeftTab('files')
      s.startRename(s.activePath)
    },
  },
  { id: 'duplicate', name: 'Duplicar nota', available: hasNote, run: () => useVault.getState().duplicate(useVault.getState().activePath!) },
  { id: 'copy-link', name: 'Copiar link da nota', available: hasNote, run: () => useVault.getState().copyLink(useVault.getState().activePath!) },
  { id: 'reveal', name: 'Mostrar nota no explorador de arquivos', available: hasNote, run: () => useVault.getState().reveal(useVault.getState().activePath!) },
  {
    id: 'reveal-tree',
    name: 'Revelar nota ativa na árvore',
    available: hasNote,
    run: () => {
      showLeft()
      useWorkspace.getState().setLeftTab('files')
      const path = useVault.getState().activePath
      if (path) requestAnimationFrame(() => document.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'center' }))
    },
  },
  { id: 'trash', name: 'Mover nota para a lixeira', available: hasNote, run: () => useVault.getState().trash(useVault.getState().activePath!) },
  { id: 'close-vault', name: 'Trocar de cofre', run: () => useVault.getState().closeVault() },

  // Interface
  { id: 'toggle-left', name: 'Alternar barra lateral esquerda', hotkey: 'Mod+\\', run: () => useVault.getState().toggleSidebar() },
  { id: 'toggle-right', name: 'Alternar barra lateral direita', hotkey: 'Mod+Shift+\\', run: () => useWorkspace.getState().toggleRight() },
  { id: 'show-files', name: 'Mostrar arquivos', run: () => (showLeft(), useWorkspace.getState().setLeftTab('files')) },
  { id: 'show-tags', name: 'Mostrar tags', run: () => (showLeft(), useWorkspace.getState().setLeftTab('tags')) },
  { id: 'show-backlinks', name: 'Mostrar backlinks', run: () => useWorkspace.getState().setRightTab('backlinks') },
  { id: 'show-outgoing', name: 'Mostrar links de saída', run: () => useWorkspace.getState().setRightTab('outgoing') },
  { id: 'show-outline', name: 'Mostrar estrutura da nota', run: () => useWorkspace.getState().setRightTab('outline') },
  { id: 'collapse-all', name: 'Recolher todas as pastas', run: () => useVault.setState({ expanded: {} }) },
  {
    id: 'theme',
    name: 'Alternar tema',
    run: () => applyTheme(nextTheme(loadTheme())),
  },
  { id: 'theme-editor', name: 'Editar tema (cores e textura)', run: () => useWorkspace.getState().openModal('theme') },
  { id: 'fullscreen', name: 'Alternar tela cheia', hotkey: 'F11', run: () => window.opalite.ui.toggleFullscreen() },

  // Edição
  { id: 'bold', name: 'Negrito', editorKey: 'Mod+B', available: hasNote, run: editor(toggleWrap('**')) },
  { id: 'italic', name: 'Itálico', editorKey: 'Mod+I', available: hasNote, run: editor(toggleWrap('*')) },
  { id: 'strike', name: 'Tachado', editorKey: 'Mod+Shift+X', available: hasNote, run: editor(toggleWrap('~~')) },
  { id: 'code', name: 'Código inline', editorKey: 'Mod+E', available: hasNote, run: editor(toggleWrap('`')) },
  { id: 'task', name: 'Alternar item de tarefa', editorKey: 'Mod+L', available: hasNote, run: editor(toggleTask) },
  { id: 'bullet', name: 'Alternar lista com marcadores', available: hasNote, run: editor(toggleBullet) },
  { id: 'numbered', name: 'Alternar lista numerada', available: hasNote, run: editor(toggleNumbered) },
  { id: 'quote', name: 'Alternar citação', available: hasNote, run: editor(toggleQuote) },
  ...[1, 2, 3, 4, 5, 6].map(
    (n): AppCommand => ({ id: `h${n}`, name: `Transformar em título ${n}`, available: hasNote, run: editor(setHeading(n)) }),
  ),
  { id: 'h0', name: 'Remover título', available: hasNote, run: editor(setHeading(0)) },
  { id: 'md-link', name: 'Inserir link Markdown', editorKey: 'Mod+K', available: hasNote, run: editor(insertMarkdownLink) },
  { id: 'wikilink', name: 'Inserir link interno', available: hasNote, run: editor(insertWikilink) },
  ...HIGHLIGHTS.map(
    (h): AppCommand => ({
      id: `highlight-${h.id}`,
      name: h.id === 'default' ? 'Realçar' : `Realçar em ${h.label.toLowerCase()}`,
      available: hasNote,
      run: editor(highlight(h.id)),
    }),
  ),
  { id: 'math-inline', name: 'Equação inline', available: hasNote, run: editor(toggleWrap('$')) },
  { id: 'comment', name: 'Comentário (oculto na leitura)', available: hasNote, run: editor(toggleWrapPair('%%', '%%')) },
  { id: 'clear-format', name: 'Limpar formatação', available: hasNote, run: editor(clearFormattingCommand) },
  { id: 'paragraph', name: 'Transformar em texto simples', available: hasNote, run: editor(plainParagraph) },
  { id: 'footnote', name: 'Inserir nota de rodapé', available: hasNote, run: editor(insertFootnote) },
  { id: 'callout', name: 'Inserir destaque (callout)', available: hasNote, run: editor(insertCallout) },
  { id: 'math-block', name: 'Inserir equação em bloco', available: hasNote, run: editor(insertMathBlock) },
  { id: 'base', name: 'Inserir nova base (tabela de notas)', available: hasNote, run: editor(insertBase) },
  { id: 'code-block', name: 'Inserir bloco de código', available: hasNote, run: editor(insertCodeBlock) },
  { id: 'table', name: 'Inserir tabela', available: hasNote, run: editor(insertTable) },
  { id: 'insert-image', name: 'Inserir imagem…', available: hasNote, run: () => void insertImageFromDisk() },
  { id: 'hr', name: 'Inserir régua horizontal', available: hasNote, run: editor(insertRule) },
  {
    id: 'date',
    name: 'Inserir data de hoje',
    available: hasNote,
    run: () => {
      const d = new Date()
      const view = documents.editorView
      if (view) insertText(view, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    },
  },
  {
    id: 'time',
    name: 'Inserir hora atual',
    available: hasNote,
    run: () => {
      const d = new Date()
      const view = documents.editorView
      if (view) insertText(view, `${pad(d.getHours())}:${pad(d.getMinutes())}`)
    },
  },
  { id: 'find', name: 'Buscar na nota atual', editorKey: 'Mod+F', available: hasNote, run: editor(openSearchPanel) },
  { id: 'replace', name: 'Buscar e substituir na nota atual', available: hasNote, run: editor((v) => openSearchPanel(v) || replaceNext(v)) },
  { id: 'select-all', name: 'Selecionar tudo', editorKey: 'Mod+A', available: hasNote, run: editor(selectAll) },
  { id: 'undo', name: 'Desfazer', editorKey: 'Mod+Z', available: hasNote, run: editor(undo) },
  { id: 'redo', name: 'Refazer', editorKey: 'Mod+Shift+Z', available: hasNote, run: editor(redo) },
]

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/** "Mod+Shift+F" -> ["Ctrl", "Shift", "F"] para exibir. */
export function formatHotkey(hotkey: string): string[] {
  return hotkey.split('+').map((k) => {
    if (k === 'Mod') return IS_MAC ? 'Cmd' : 'Ctrl'
    if (k === 'Alt') return IS_MAC ? 'Option' : 'Alt'
    if (k === 'ArrowLeft') return '←'
    if (k === 'ArrowRight') return '→'
    if (k === 'Tab') return 'Tab'
    return k.length === 1 ? k.toUpperCase() : k
  })
}

function matches(hotkey: string, e: KeyboardEvent): boolean {
  const parts = hotkey.split('+')
  const key = parts[parts.length - 1]!
  const want = new Set(parts.slice(0, -1))
  const mod = IS_MAC ? e.metaKey : e.ctrlKey
  if (want.has('Mod') !== mod) return false
  if (want.has('Shift') !== e.shiftKey) return false
  if (want.has('Alt') !== e.altKey) return false
  // e.code cobre teclados em que Shift muda o caractere ("\" vira "|").
  if (key === '\\') return e.code === 'Backslash'
  if (key.length === 1) return e.key.toLowerCase() === key.toLowerCase() || e.code === `Key${key.toUpperCase()}`
  return e.key === key
}

/** Executa o comando global que corresponde ao atalho. Retorna true se tratou. */
export function handleGlobalKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false // um componente (ex.: a árvore) já tratou
  for (const cmd of COMMANDS) {
    if (!cmd.hotkey || !matches(cmd.hotkey, e)) continue
    if (cmd.available && !cmd.available()) return false
    e.preventDefault()
    void cmd.run()
    return true
  }
  return false
}

/** Escolhe imagens no disco, copia para a pasta de anexos e incorpora na nota. */
async function insertImageFromDisk(): Promise<void> {
  const { importFiles, embedFor } = await import('./attachments')
  const { attachmentsFolder } = await import('./settings')
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*'
  input.onchange = async () => {
    const files = [...(input.files ?? [])]
    if (!files.length) return
    const { paths, errors } = await importFiles(files, attachmentsFolder())
    await useVault.getState().refreshTree()
    const view = documents.editorView
    if (view && paths.length) {
      const text = paths.map(embedFor).join('\n')
      const { from, to } = view.state.selection.main
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input' })
      view.focus()
    }
    if (errors.length) useVault.setState({ error: errors.join('\n') })
  }
  input.click()
}
