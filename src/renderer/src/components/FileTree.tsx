import { ChevronRight, CopyPlus, ExternalLink, FileOutput, FilePlus, FolderOpen, FolderPlus, History, Link2, Pencil, Search, Star, Trash2 } from 'lucide-react'
import { useFavorites } from '../state/favorites-store'
import { type MenuItem, openMenu } from './ui/Menu'
import { CanvasGlyph } from './ui/glyphs'
import { type KeyboardEvent, type MouseEvent, memo, useEffect, useRef, useState } from 'react'
import { embedFor, extOf } from '../lib/attachments'
import { CONVERTIBLE_EXTS } from '../lib/convert/registry'
import { join, parentOf } from '../lib/paths'
import type { EntryKind, EntryMenuAction, TreeNode } from '../../../shared/types'
import { documents } from '../editor/document-manager'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './FileTree.module.css'

/** Itens do menu do botão direito na árvore (mesmo visual animado do editor). */
function entryItems(kind: EntryKind, path: string | null): MenuItem[] {
  const fav = path ? useFavorites.getState().isFavorite(path) : false
  const favItem: MenuItem = { id: 'favorite', label: fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos', icon: Star }
  const reveal: MenuItem = { id: 'reveal', label: navigator.userAgent.includes('Mac') ? 'Mostrar no Finder' : 'Mostrar no Explorador', icon: FolderOpen }
  const trash: MenuItem = { id: 'trash', label: 'Mover para a lixeira', icon: Trash2, danger: true, shortcut: 'Del' }
  if (kind === 'file' || kind === 'file-convertible') {
    return [
      ...(kind === 'file-convertible' ? [{ id: 'convert', label: 'Converter…', icon: FileOutput } as MenuItem, { type: 'separator' } as MenuItem] : []),
      { id: 'open-external', label: 'Abrir no aplicativo padrão', icon: ExternalLink },
      { id: 'rename', label: 'Renomear', icon: Pencil, shortcut: 'F2' },
      { id: 'duplicate', label: 'Duplicar', icon: CopyPlus },
      { id: 'copy-link', label: 'Copiar link da nota', icon: Link2 },
      favItem,
      { id: 'history', label: 'Histórico de versões', icon: History },
      reveal,
      { type: 'separator' },
      trash,
    ]
  }
  if (kind === 'folder') {
    return [
      { id: 'new-note', label: 'Nova nota', icon: FilePlus },
      { id: 'new-folder', label: 'Nova pasta', icon: FolderPlus },
      { id: 'search-in-folder', label: 'Buscar nesta pasta', icon: Search },
      { type: 'separator' },
      { id: 'rename', label: 'Renomear', icon: Pencil, shortcut: 'F2' },
      favItem,
      reveal,
      { type: 'separator' },
      trash,
    ]
  }
  return [
    { id: 'new-note', label: 'Nova nota', icon: FilePlus },
    { id: 'new-folder', label: 'Nova pasta', icon: FolderPlus },
  ]
}

async function runMenu(kind: EntryKind, node: TreeNode | null, at: { x: number; y: number }): Promise<void> {
  const choice = await openMenu(entryItems(kind, node?.path ?? null), at)
  if (choice === 'favorite' && node) return useFavorites.getState().toggle(node.path)
  if (choice === 'history' && node) return useWorkspace.getState().openHistory(node.path)
  const action = choice as EntryMenuAction | null
  const store = useVault.getState()
  const folder = node?.kind === 'folder' ? node.path : ''
  switch (action) {
    case 'new-note':
      if (folder) useVault.setState((s) => ({ expanded: { ...s.expanded, [folder]: true } }))
      return store.createNote(folder)
    case 'new-folder':
      if (folder) useVault.setState((s) => ({ expanded: { ...s.expanded, [folder]: true } }))
      return store.createFolder(folder)
    case 'rename':
      if (node) store.startRename(node.path)
      return
    case 'reveal':
      if (node) return store.reveal(node.path)
      return
    case 'trash':
      if (node) return store.trash(node.path)
      return
    case 'duplicate':
      if (node) return store.duplicate(node.path)
      return
    case 'copy-link':
      if (node) return store.copyLink(node.path)
      return
    case 'convert':
      if (node) useWorkspace.getState().openConverter(node.path)
      return
    case 'open-external':
      if (node) void window.opalite.files.openExternal(node.path).catch((err: Error) => useVault.setState({ error: err.message }))
      return
    case 'search-in-folder':
      if (node) useWorkspace.getState().search(`path:"${node.path}" `)
      return
    default:
      return
  }
}

const TREE_MIME = 'application/x-opalite-path'

/** Move um arquivo ou pasta para dentro de `folder` ("" = raiz). */
async function moveInto(path: string, folder: string): Promise<void> {
  if (!path || parentOf(path) === folder || path === folder || folder.startsWith(`${path}/`)) return
  const name = path.slice(path.lastIndexOf('/') + 1)
  await useVault.getState().moveEntry(path, join(folder, name))
  if (folder) useVault.setState((s) => ({ expanded: { ...s.expanded, [folder]: true } }))
}

export function FileTree() {
  const tree = useVault((s) => s.tree)

  const onRootMenu = (e: MouseEvent) => {
    e.preventDefault()
    void runMenu('root', null, { x: e.clientX, y: e.clientY })
  }

  return (
    <div
      className={styles.scroll}
      onContextMenu={onRootMenu}
      data-tree-root
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TREE_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(TREE_MIME)) return
        e.preventDefault()
        void moveInto(e.dataTransfer.getData(TREE_MIME), '')
      }}
    >
      {tree.length === 0 ? (
        <p className={styles.empty}>Este cofre está vazio. Crie uma nota com Ctrl+N.</p>
      ) : (
        <div role="tree" aria-label="Arquivos do cofre" className={styles.tree}>
          {tree.map((node) => (
            <TreeItem key={node.path} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  )
}

// memo: ao abrir uma nota, só os itens cujo estado mudou são re-renderizados.
const TreeItem = memo(function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const isFolder = node.kind === 'folder'
  const expanded = useVault((s) => isFolder && Boolean(s.expanded[node.path]))
  const active = useVault((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path === node.path)
  const renaming = useVault((s) => s.renamingPath === node.path)

  const activate = (newTab = false) => {
    const store = useVault.getState()
    if (isFolder) store.toggleFolder(node.path)
    else void store.openFile(node.path, { newTab })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const store = useVault.getState()
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate()
    } else if (e.key === 'F2') {
      e.preventDefault()
      store.startRename(node.path)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      void store.trash(node.path)
    } else if (isFolder && e.key === 'ArrowRight' && !expanded) {
      store.toggleFolder(node.path)
    } else if (isFolder && e.key === 'ArrowLeft' && expanded) {
      store.toggleFolder(node.path)
    }
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const convertible = node.kind === 'file' && CONVERTIBLE_EXTS.has(extOf(node.path))
    void runMenu(convertible ? 'file-convertible' : node.kind, node, { x: e.clientX, y: e.clientY })
  }

  const label = node.kind === 'file' ? node.title : node.name
  const [dropping, setDropping] = useState(false)

  // Arrastar itens da árvore: soltar numa pasta move o item; soltar na nota
  // insere o link (o editor usa o text/plain automaticamente).
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(TREE_MIME, node.path)
    e.dataTransfer.setData('text/plain', node.kind === 'file' ? embedFor(node.path) : node.path)
    e.dataTransfer.effectAllowed = 'copyMove'
  }
  const acceptsMove = (e: React.DragEvent) => isFolder && e.dataTransfer.types.includes(TREE_MIME)
  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    if (!acceptsMove(e)) return
    e.preventDefault()
    e.stopPropagation()
    void moveInto(e.dataTransfer.getData(TREE_MIME), node.path)
  }

  return (
    <div role="none">
      <div
        role="treeitem"
        aria-selected={active}
        aria-expanded={isFolder ? expanded : undefined}
        tabIndex={0}
        className={styles.row}
        data-active={active || undefined}
        data-kind={node.kind}
        data-path={node.path}
        data-drop-target={dropping || undefined}
        draggable={!renaming}
        onDragStart={onDragStart}
        onDragOver={(e) => {
          if (!acceptsMove(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={(e) => activate(e.ctrlKey || e.metaKey)}
        onAuxClick={(e) => e.button === 1 && !isFolder && activate(true)}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        title={node.path}
      >
        <span className={styles.chevron} data-open={expanded || undefined}>
          {isFolder && <ChevronRight size={13} strokeWidth={2} />}
        </span>
        {renaming ? (
          <RenameInput path={node.path} initial={label} />
        ) : (
          <>
            <span className={styles.label}>{label}</span>
            {node.kind === 'file' && node.ext === 'canvas' && <CanvasGlyph size={13} className={styles.badge} />}
          </>
        )}
      </div>
      {node.kind === 'folder' && expanded && (
        <div role="group" className={styles.group}>
          {node.children.map((child) => (
            <TreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
})

function RenameInput({ path, initial }: { path: string; initial: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    void useVault.getState().commitRename(path, ref.current?.value ?? initial)
  }

  const cancel = () => {
    if (done.current) return
    done.current = true
    useVault.getState().cancelRename()
  }

  return (
    <input
      ref={ref}
      className={styles.rename}
      defaultValue={initial}
      aria-label="Novo nome"
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key !== 'Enter' && e.key !== 'Escape') return
        if (e.key === 'Enter') commit()
        else cancel()
        // Depois de nomear uma nota, o natural é começar a escrever nela.
        if (path.toLowerCase().endsWith('.md')) documents.focus()
      }}
      onBlur={commit}
    />
  )
}
