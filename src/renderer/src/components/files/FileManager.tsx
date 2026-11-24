import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileOutput,
  FilePlus,
  FolderInput,
  FolderOpen,
  FolderPlus,
  History,
  LayoutGrid,
  List,
  PanelRight,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeFolder, TreeNode } from '../../../../shared/types'
import { normalizeText } from '../../../../shared/text'
import { blobUrl, formatBytes, importFiles } from '../../lib/attachments'
import { notify } from '../../lib/flushers'
import { join, parentOf } from '../../lib/paths'
import { CONVERTIBLE_EXTS } from '../../lib/convert/registry'
import { attachmentsFolder } from '../../lib/settings'
import { useFavorites } from '../../state/favorites-store'
import { useVault } from '../../state/vault-store'
import { useWorkspace } from '../../state/workspace-store'
import { type MenuItem, openMenu } from '../ui/Menu'
import { CATEGORY_LABEL, type Category, FILTERS, categoryOf, iconOf, matchesFilter } from './file-types'
import styles from './FileManager.module.css'
import { NEW_FILE_KINDS, createOfficeFile } from './new-files'

/*
 * Gerenciador de arquivos do cofre, na linha do Google Drive: pastas em
 * cartões, busca, filtros por tipo, ordenação, favoritos e recentes, mover
 * arrastando, renomear (F2), excluir (Del) e um painel de detalhes com as
 * notas que citam o arquivo. Tudo opera nos arquivos reais do cofre; links
 * [[...]] são atualizados ao renomear/mover, como na árvore lateral.
 */

type Section = 'vault' | 'favorites' | 'recent'
type SortKey = 'name' | 'mtime' | 'size' | 'type'
type ViewMode = 'grid' | 'list'

interface Item {
  path: string
  name: string
  title: string
  isFolder: boolean
  cat: Category
  /** Quantos itens a pasta contém (só pastas). */
  count?: number
}

interface Prefs {
  view: ViewMode
  sort: SortKey
  desc: boolean
  details: boolean
}

const PREFS_KEY = 'opalite:files-prefs'
const DRAG_TYPE = 'application/x-opalite-paths'
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function loadPrefs(): Prefs {
  try {
    return { view: 'grid', sort: 'name', desc: false, details: true, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return { view: 'grid', sort: 'name', desc: false, details: true }
  }
}

const toItem = (n: TreeNode): Item =>
  n.kind === 'folder'
    ? { path: n.path, name: n.name, title: n.name, isFolder: true, cat: 'folder', count: n.children.length }
    : { path: n.path, name: n.name, title: n.title, isFolder: false, cat: categoryOf(n.path) }

function findFolder(tree: TreeNode[], path: string): TreeNode[] | null {
  if (!path) return tree
  let level = tree
  for (const part of path.split('/')) {
    const next = level.find((n): n is TreeFolder => n.kind === 'folder' && n.name === part)
    if (!next) return null
    level = next.children
  }
  return level
}

function walk(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    out.push(n)
    if (n.kind === 'folder') walk(n.children, out)
  }
  return out
}

const when = (t?: number) =>
  t ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t) : '—'

const shortWhen = (t?: number) => {
  if (!t) return ''
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return `hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export default function FileManager() {
  const tree = useVault((s) => s.tree)
  const favorites = useFavorites((s) => s.paths)
  const [folder, setFolder] = useState(() => localStorage.getItem('opalite:files-folder') ?? '')
  const [section, setSection] = useState<Section>('vault')
  const [filter, setFilter] = useState<'all' | Category>('all')
  const [query, setQuery] = useState('')
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, { size: number; mtimeMs: number }>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const updatePrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // sem armazenamento
      }
      return next
    })

  // A pasta atual sumiu (renomeada/apagada por fora): volta para a raiz.
  useEffect(() => {
    if (folder && !findFolder(tree, folder)) setFolder('')
  }, [tree, folder])

  useEffect(() => {
    try {
      localStorage.setItem('opalite:files-folder', folder)
    } catch {
      // sem armazenamento
    }
    setSelected([])
  }, [folder, section])

  const all = useMemo(() => walk(tree), [tree])

  // Tamanho e data de tudo (uma chamada; o cofre inteiro cabe com folga).
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void window.opalite.files.stats(all.map((n) => n.path)).then((s) => !cancelled && setStats(s))
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [all])

  const items = useMemo(() => {
    let list: Item[]
    const q = normalizeText(query.trim())
    if (q) list = all.filter((n) => normalizeText(n.name).includes(q)).map(toItem)
    else if (section === 'favorites') list = all.filter((n) => favorites.includes(n.path)).map(toItem)
    else if (section === 'recent')
      list = all
        .filter((n) => n.kind === 'file')
        .map(toItem)
        .sort((a, b) => (stats[b.path]?.mtimeMs ?? 0) - (stats[a.path]?.mtimeMs ?? 0))
        .slice(0, 60)
    else list = (findFolder(tree, folder) ?? []).map(toItem)

    list = list.filter((i) => i.isFolder || matchesFilter(i.cat, filter))
    if (section === 'recent' && !q) return list
    const dir = prefs.desc ? -1 : 1
    const cmp = (a: Item, b: Item) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      let r = 0
      if (prefs.sort === 'mtime') r = (stats[a.path]?.mtimeMs ?? 0) - (stats[b.path]?.mtimeMs ?? 0)
      else if (prefs.sort === 'size') r = (stats[a.path]?.size ?? 0) - (stats[b.path]?.size ?? 0)
      else if (prefs.sort === 'type') r = collator.compare(CATEGORY_LABEL[a.cat], CATEGORY_LABEL[b.cat])
      return (r || collator.compare(a.name, b.name)) * dir
    }
    return list.sort(cmp)
  }, [all, tree, folder, section, query, filter, prefs.sort, prefs.desc, favorites, stats])

  const folders = items.filter((i) => i.isFolder)
  const files = items.filter((i) => !i.isFolder)
  const ordered = useMemo(() => [...folders, ...files], [folders, files])
  const primary = selected.length ? ordered.find((i) => i.path === selected[selected.length - 1]) ?? null : null

  // ------------------------------------------------------------ ações

  const open = useCallback((item: Item, newTab = false) => {
    if (item.isFolder) {
      setSection('vault')
      setQuery('')
      setFolder(item.path)
      return
    }
    void useVault.getState().openFile(item.path, { newTab })
  }, [])

  const select = (item: Item, e: React.MouseEvent | React.KeyboardEvent) => {
    if (e.shiftKey && anchor) {
      const a = ordered.findIndex((i) => i.path === anchor)
      const b = ordered.findIndex((i) => i.path === item.path)
      const [from, to] = a < b ? [a, b] : [b, a]
      setSelected(ordered.slice(from, to + 1).map((i) => i.path))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(item.path) ? s.filter((p) => p !== item.path) : [...s, item.path]))
      setAnchor(item.path)
      return
    }
    setSelected([item.path])
    setAnchor(item.path)
  }

  const moveTo = async (paths: string[], target: string) => {
    for (const p of paths) {
      if (p === target || target.startsWith(`${p}/`) || parentOf(p) === target) continue
      await useVault.getState().moveEntry(p, join(target, p.slice(p.lastIndexOf('/') + 1)))
    }
    setSelected([])
  }

  const remove = async (paths: string[]) => {
    for (const p of paths) await useVault.getState().trash(p)
    setSelected([])
  }

  const newFolder = async () => {
    try {
      const path = await window.opalite.files.createFolder(join(section === 'vault' ? folder : '', 'Nova pasta'))
      await useVault.getState().refreshTree()
      setSection('vault')
      setSelected([path])
      setRenaming(path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const newFile = async (kind: string) => {
    const dir = section === 'vault' ? folder : ''
    try {
      let path: string
      if (kind === 'note') path = await window.opalite.files.createNote(join(dir, 'Sem título.md'))
      else if (kind === 'canvas') path = await window.opalite.files.createCanvas(join(dir, 'Sem título.canvas'))
      else path = await createOfficeFile(kind, dir)
      await useVault.getState().refreshTree()
      setSection('vault')
      setSelected([path])
      setRenaming(path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const upload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      const list = [...(input.files ?? [])]
      if (!list.length) return
      const { paths, errors } = await importFiles(list, section === 'vault' ? folder : attachmentsFolder())
      await useVault.getState().refreshTree()
      if (errors.length) notify(errors.join('\n'), 'error')
      else notify(`${paths.length} ${paths.length === 1 ? 'arquivo enviado' : 'arquivos enviados'}.`, 'notice')
      setSelected(paths)
    }
    input.click()
  }

  const copyLink = (item: Item) => {
    const target = item.path.toLowerCase().endsWith('.md') ? item.path.slice(0, -3) : item.path
    void navigator.clipboard.writeText(`[[${target}]]`).then(() => notify('Link copiado. Cole numa nota para vincular.', 'notice'))
  }

  const newMenu = async (at: { x: number; y: number }) => {
    const id = await openMenu(
      [
        { id: 'folder', label: 'Pasta', icon: FolderPlus },
        { type: 'separator' },
        { id: 'note', label: 'Nota', icon: FilePlus },
        ...NEW_FILE_KINDS.map((k) => ({ id: k.id, label: k.label, icon: k.icon })),
        { id: 'canvas', label: 'Canvas', icon: iconOf('', 'canvas') },
        { type: 'separator' },
        { id: 'upload', label: 'Enviar arquivos…', icon: Upload },
      ],
      at,
    )
    if (id === 'folder') void newFolder()
    else if (id === 'upload') upload()
    else if (id) void newFile(id)
  }

  const itemMenu = async (item: Item, at: { x: number; y: number }) => {
    const paths = selected.includes(item.path) ? selected : [item.path]
    if (!selected.includes(item.path)) setSelected([item.path])
    const many = paths.length > 1
    const fav = useFavorites.getState().isFavorite(item.path)
    const folderTargets: MenuItem[] = walk(tree)
      .filter((n) => n.kind === 'folder' && !paths.some((p) => n.path === p || n.path.startsWith(`${p}/`)))
      .slice(0, 40)
      .map((n) => ({ id: `move:${n.path}`, label: n.path, icon: FolderOpen }))
    const items: MenuItem[] = [
      { id: 'open', label: item.isFolder ? 'Abrir pasta' : 'Abrir', icon: FolderOpen, disabled: many },
      ...(!item.isFolder ? [{ id: 'open-tab', label: 'Abrir em nova aba', icon: Plus, disabled: many }] : []),
      { type: 'separator' },
      { id: 'rename', label: 'Renomear', icon: Pencil, shortcut: 'F2', disabled: many },
      { id: 'move', label: 'Mover para', icon: FolderInput, submenu: [{ id: 'move:', label: '(raiz do cofre)', icon: FolderOpen }, ...folderTargets] },
      { id: 'favorite', label: fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos', icon: Star, disabled: many },
      ...(!item.isFolder
        ? [
            { id: 'link', label: 'Copiar link para nota', icon: Copy, disabled: many },
            { id: 'history', label: 'Histórico de versões', icon: History, disabled: many },
            ...(CONVERTIBLE_EXTS.has(item.path.slice(item.path.lastIndexOf('.') + 1).toLowerCase()) ? [{ id: 'convert', label: 'Converter…', icon: FileOutput, disabled: many }] : []),
          ]
        : []),
      { id: 'reveal', label: 'Mostrar no explorador', icon: ExternalLink, disabled: many },
      { type: 'separator' },
      { id: 'trash', label: many ? `Mover ${paths.length} itens para a lixeira` : 'Mover para a lixeira', icon: Trash2, danger: true, shortcut: 'Del' },
    ]
    const id = await openMenu(items, at)
    if (!id) return
    if (id === 'open') open(item)
    else if (id === 'open-tab') open(item, true)
    else if (id === 'rename') setRenaming(item.path)
    else if (id.startsWith('move:')) void moveTo(paths, id.slice(5))
    else if (id === 'favorite') useFavorites.getState().toggle(item.path)
    else if (id === 'link') copyLink(item)
    else if (id === 'history') useWorkspace.getState().openHistory(item.path)
    else if (id === 'convert') useWorkspace.getState().openConverter(item.path)
    else if (id === 'reveal') void useVault.getState().reveal(item.path)
    else if (id === 'trash') void remove(paths)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const idx = primary ? ordered.indexOf(primary) : -1
    if (e.key === 'Delete' && selected.length) void remove(selected)
    else if (e.key === 'F2' && primary) setRenaming(primary.path)
    else if (e.key === 'Enter' && primary) open(primary, e.ctrlKey)
    else if (e.key === 'Backspace' && section === 'vault' && folder) setFolder(parentOf(folder))
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && ordered.length) {
      const next = ordered[Math.min(ordered.length - 1, idx + 1)]!
      setSelected([next.path])
      setAnchor(next.path)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && ordered.length) {
      const prev = ordered[Math.max(0, idx - 1)]!
      setSelected([prev.path])
      setAnchor(prev.path)
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) setSelected(ordered.map((i) => i.path))
    else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) searchRef.current?.focus()
    else if (e.key === 'Escape') setSelected([])
    else return
    e.preventDefault()
  }

  // ------------------------------------------------------------ arrastar

  const dragProps = (item: Item) => ({
    draggable: renaming !== item.path,
    onDragStart: (e: React.DragEvent) => {
      const paths = selected.includes(item.path) ? selected : [item.path]
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths))
      // Arrastar para uma nota cria o link/embed.
      e.dataTransfer.setData('text/plain', paths.map((p) => (p.toLowerCase().endsWith('.md') ? `[[${p.slice(0, -3)}]]` : `![[${p}]]`)).join('\n'))
      e.dataTransfer.effectAllowed = 'copyMove'
    },
  })

  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropOn(target)
    },
    onDragLeave: () => setDropOn((d) => (d === target ? null : d)),
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_TYPE)
      setDropOn(null)
      if (!raw) return
      e.preventDefault()
      e.stopPropagation()
      void moveTo(JSON.parse(raw) as string[], target)
    },
  })

  // ------------------------------------------------------------ render

  const crumbs = folder ? folder.split('/') : []
  const title = query ? `Resultados para “${query}”` : section === 'favorites' ? 'Favoritos' : section === 'recent' ? 'Recentes' : null

  return (
    <div ref={rootRef} className={styles.root} data-details={prefs.details || undefined} onKeyDown={onKeyDown} tabIndex={-1}>
      <nav className={styles.nav} aria-label="Seções">
        <button className={styles.newBtn} onClick={(e) => void newMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 6 })}>
          <Plus size={16} /> Novo
        </button>
        {(
          [
            ['vault', 'Meu cofre', FolderOpen],
            ['favorites', 'Favoritos', Star],
            ['recent', 'Recentes', Clock],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className={styles.navItem}
            data-on={section === id && !query ? true : undefined}
            onClick={() => {
              setQuery('')
              setSection(id)
              if (id === 'vault') setFolder('')
            }}
            {...(id === 'vault' ? dropProps('') : {})}
            data-drop={dropOn === '' && id === 'vault' ? true : undefined}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
        <div className={styles.navLabel}>Tipos</div>
        {FILTERS.map((f) => (
          <button key={f.id} className={styles.navItem} data-on={filter === f.id || undefined} onClick={() => setFilter(f.id)}>
            <span className={styles.dot} data-cat={f.id} /> {f.label}
          </button>
        ))}
      </nav>

      <section className={styles.main} data-drop-folder={section === 'vault' ? folder : attachmentsFolder()}>
        <header className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={15} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no cofre (Ctrl+F)" spellCheck={false} aria-label="Buscar arquivos" />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Limpar busca">
                <X size={14} />
              </button>
            )}
          </div>
          <div className={styles.tools}>
            <select value={prefs.sort} onChange={(e) => updatePrefs({ sort: e.target.value as SortKey })} aria-label="Ordenar por">
              <option value="name">Nome</option>
              <option value="mtime">Modificado</option>
              <option value="size">Tamanho</option>
              <option value="type">Tipo</option>
            </select>
            <button className={styles.tool} onClick={() => updatePrefs({ desc: !prefs.desc })} title={prefs.desc ? 'Decrescente' : 'Crescente'} aria-label="Inverter ordem">
              {prefs.desc ? <ArrowUpAZ size={16} /> : <ArrowDownAZ size={16} />}
            </button>
            <div className={styles.segmented} role="radiogroup" aria-label="Visualização">
              <button role="radio" aria-checked={prefs.view === 'grid'} data-on={prefs.view === 'grid' || undefined} onClick={() => updatePrefs({ view: 'grid' })} title="Grade">
                <LayoutGrid size={15} />
              </button>
              <button role="radio" aria-checked={prefs.view === 'list'} data-on={prefs.view === 'list' || undefined} onClick={() => updatePrefs({ view: 'list' })} title="Lista">
                <List size={15} />
              </button>
            </div>
            <button className={styles.tool} data-on={prefs.details || undefined} onClick={() => updatePrefs({ details: !prefs.details })} title="Detalhes" aria-label="Painel de detalhes" aria-pressed={prefs.details}>
              <PanelRight size={16} />
            </button>
          </div>
        </header>

        <div className={styles.crumbs}>
          {title ? (
            <h2>{title}</h2>
          ) : (
            <>
              <button className={styles.crumb} data-drop={dropOn === '' || undefined} onClick={() => setFolder('')} {...dropProps('')}>
                Meu cofre
              </button>
              {crumbs.map((part, i) => {
                const path = crumbs.slice(0, i + 1).join('/')
                return (
                  <span key={path} className={styles.crumbWrap}>
                    <ChevronRight size={14} />
                    <button className={styles.crumb} data-drop={dropOn === path || undefined} onClick={() => setFolder(path)} {...dropProps(path)}>
                      {part}
                    </button>
                  </span>
                )
              })}
            </>
          )}
          <span className={styles.count}>
            {folders.length > 0 && `${folders.length} ${folders.length === 1 ? 'pasta' : 'pastas'}`}
            {folders.length > 0 && files.length > 0 && ' · '}
            {files.length > 0 && `${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}`}
          </span>
        </div>

        <div
          className={styles.scroll}
          onClick={(e) => e.target === e.currentTarget && setSelected([])}
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return
            e.preventDefault()
            void newMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          {ordered.length === 0 && (
            <div className={styles.empty}>
              <FolderOpen size={36} strokeWidth={1.2} />
              <p>{query ? 'Nada encontrado com esse nome.' : section === 'favorites' ? 'Marque arquivos com a estrela para vê-los aqui.' : 'Pasta vazia. Arraste arquivos para cá ou use “Novo”.'}</p>
            </div>
          )}

          {prefs.view === 'grid' ? (
            <>
              {folders.length > 0 && <div className={styles.groupLabel}>Pastas</div>}
              <div className={styles.folderGrid}>
                {folders.map((item) => (
                  <div
                    key={item.path}
                    className={styles.folderCard}
                    data-selected={selected.includes(item.path) || undefined}
                    data-drop={dropOn === item.path || undefined}
                    data-drop-folder={item.path}
                    tabIndex={0}
                    onClick={(e) => select(item, e)}
                    onDoubleClick={() => open(item)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      void itemMenu(item, { x: e.clientX, y: e.clientY })
                    }}
                    {...dragProps(item)}
                    {...dropProps(item.path)}
                  >
                    <FolderOpen size={18} className={styles.folderIcon} />
                    <Name item={item} renaming={renaming === item.path} onDone={() => setRenaming(null)} />
                    {favorites.includes(item.path) && <Star size={12} className={styles.star} fill="currentColor" />}
                    <small>{item.count}</small>
                  </div>
                ))}
              </div>
              {files.length > 0 && <div className={styles.groupLabel}>Arquivos</div>}
              <div className={styles.fileGrid}>
                {files.map((item) => {
                  const Icon = iconOf(item.path, item.cat)
                  return (
                    <div
                      key={item.path}
                      className={styles.fileCard}
                      data-selected={selected.includes(item.path) || undefined}
                      tabIndex={0}
                      title={item.path}
                      onClick={(e) => select(item, e)}
                      onDoubleClick={(e) => open(item, e.ctrlKey)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        void itemMenu(item, { x: e.clientX, y: e.clientY })
                      }}
                      {...dragProps(item)}
                    >
                      <div className={styles.thumb} data-cat={item.cat}>
                        {item.cat === 'image' ? <Thumb path={item.path} /> : <Icon size={34} strokeWidth={1.3} />}
                        <span className={styles.badge} data-cat={item.cat}>
                          {item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.') + 1).toUpperCase() : ''}
                        </span>
                      </div>
                      <div className={styles.cardInfo}>
                        <Icon size={14} className={styles.kindIcon} data-cat={item.cat} />
                        <Name item={item} renaming={renaming === item.path} onDone={() => setRenaming(null)} />
                        {favorites.includes(item.path) && <Star size={12} className={styles.star} fill="currentColor" />}
                      </div>
                      <small className={styles.meta}>
                        {shortWhen(stats[item.path]?.mtimeMs)}
                        {stats[item.path] ? ` · ${formatBytes(stats[item.path]!.size)}` : ''}
                      </small>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            ordered.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    {(
                      [
                        ['name', 'Nome'],
                        ['type', 'Tipo'],
                        ['mtime', 'Modificado'],
                        ['size', 'Tamanho'],
                      ] as const
                    ).map(([key, label]) => (
                      <th key={key} onClick={() => updatePrefs(prefs.sort === key ? { desc: !prefs.desc } : { sort: key, desc: false })} data-on={prefs.sort === key || undefined}>
                        {label}
                        {prefs.sort === key && (prefs.desc ? ' ↓' : ' ↑')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((item) => {
                    const Icon = iconOf(item.path, item.cat)
                    return (
                      <tr
                        key={item.path}
                        data-selected={selected.includes(item.path) || undefined}
                        data-drop={dropOn === item.path || undefined}
                        tabIndex={0}
                        title={item.path}
                        onClick={(e) => select(item, e)}
                        onDoubleClick={(e) => open(item, e.ctrlKey)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          void itemMenu(item, { x: e.clientX, y: e.clientY })
                        }}
                        {...dragProps(item)}
                        {...(item.isFolder ? { ...dropProps(item.path), 'data-drop-folder': item.path } : {})}
                      >
                        <td>
                          <span className={styles.nameCell}>
                            <Icon size={15} className={styles.kindIcon} data-cat={item.cat} />
                            <Name item={item} renaming={renaming === item.path} onDone={() => setRenaming(null)} />
                            {favorites.includes(item.path) && <Star size={11} className={styles.star} fill="currentColor" />}
                          </span>
                          {query && <small className={styles.inFolder}>{parentOf(item.path) || 'raiz'}</small>}
                        </td>
                        <td>{CATEGORY_LABEL[item.cat]}</td>
                        <td>{shortWhen(stats[item.path]?.mtimeMs)}</td>
                        <td>{item.isFolder ? `${item.count} ${item.count === 1 ? "item" : "itens"}` : stats[item.path] ? formatBytes(stats[item.path]!.size) : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          )}
        </div>
      </section>

      {prefs.details && <Details item={primary} count={selected.length} stat={primary ? stats[primary.path] : undefined} onOpen={open} onMenu={itemMenu} />}
    </div>
  )
}

/** Nome do item, com edição no lugar (F2 / "Renomear"). */
function Name({ item, renaming, onDone }: { item: Item; renaming: boolean; onDone(): void }) {
  const ext = !item.isFolder && item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.')) : ''
  const stem = ext ? item.name.slice(0, -ext.length) : item.name
  const [text, setText] = useState(stem)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) {
      setText(stem)
      requestAnimationFrame(() => ref.current?.select())
    }
  }, [renaming, stem])
  if (!renaming) return <span className={styles.name}>{item.cat === 'note' || item.cat === 'canvas' ? item.title : item.name}</span>
  const commit = async () => {
    const clean = text.trim()
    onDone()
    if (!clean || clean === stem) return
    await useVault.getState().moveEntry(item.path, join(parentOf(item.path), clean + ext))
  }
  return (
    <input
      ref={ref}
      className={styles.renameInput}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') onDone()
      }}
      spellCheck={false}
      aria-label="Novo nome"
    />
  )
}

/** Miniatura de imagem, carregada só quando o cartão aparece na tela. */
function Thumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        io.disconnect()
        void blobUrl(path).then(setUrl).catch(() => {})
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [path])
  return <div ref={ref} className={styles.thumbImg}>{url && <img src={url} alt="" draggable={false} />}</div>
}

/** Painel de detalhes: informações e as notas que citam o arquivo. */
function Details({
  item,
  count,
  stat,
  onOpen,
  onMenu,
}: {
  item: Item | null
  count: number
  stat?: { size: number; mtimeMs: number }
  onOpen(item: Item): void
  onMenu(item: Item, at: { x: number; y: number }): void
}) {
  const [links, setLinks] = useState<Array<{ path: string; title: string }> | null>(null)

  useEffect(() => {
    setLinks(null)
    if (!item || item.isFolder) return
    let cancelled = false
    const timer = setTimeout(() => {
      void window.opalite.index
        .backlinks(item.path, { unlinked: false })
        .then((b) => !cancelled && setLinks(b.linked.map((g) => ({ path: g.path, title: g.title }))))
        .catch(() => !cancelled && setLinks([]))
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [item])

  if (count > 1) {
    return (
      <aside className={styles.details}>
        <div className={styles.detailsEmpty}>{count} itens selecionados</div>
      </aside>
    )
  }
  if (!item) {
    return (
      <aside className={styles.details}>
        <div className={styles.detailsEmpty}>Selecione um item para ver os detalhes.</div>
      </aside>
    )
  }
  const Icon = iconOf(item.path, item.cat)
  return (
    <aside className={styles.details} aria-label="Detalhes">
      <div className={styles.preview} data-cat={item.cat}>
        {item.cat === 'image' ? <Thumb path={item.path} /> : <Icon size={46} strokeWidth={1.2} />}
      </div>
      <h3 className={styles.detailsTitle}>{item.isFolder ? item.name : item.name}</h3>
      <dl className={styles.props}>
        <dt>Tipo</dt>
        <dd>{CATEGORY_LABEL[item.cat]}</dd>
        {!item.isFolder && (
          <>
            <dt>Tamanho</dt>
            <dd>{stat ? formatBytes(stat.size) : '—'}</dd>
          </>
        )}
        <dt>Modificado</dt>
        <dd>{when(stat?.mtimeMs)}</dd>
        <dt>Local</dt>
        <dd>{parentOf(item.path) || 'Raiz do cofre'}</dd>
      </dl>
      <div className={styles.detailActions}>
        <button onClick={() => onOpen(item)}>{item.isFolder ? 'Abrir pasta' : 'Abrir'}</button>
        <button
          aria-label="Mais ações"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(item, { x: r.left, y: r.bottom + 4 })
          }}
        >
          Mais…
        </button>
      </div>
      {!item.isFolder && (
        <>
          <h4 className={styles.detailsLabel}>Citado em</h4>
          {links === null ? (
            <p className={styles.muted}>…</p>
          ) : links.length === 0 ? (
            <p className={styles.muted}>Nenhuma nota cita este arquivo ainda. Arraste-o para uma nota para vincular.</p>
          ) : (
            <ul className={styles.links}>
              {links.map((l) => (
                <li key={l.path}>
                  <button onClick={() => void useVault.getState().openFile(l.path)}>{l.title}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  )
}
