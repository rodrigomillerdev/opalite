import { File, FileText, Folder, Star } from 'lucide-react'
import { kindOf } from '../lib/attachments'
import { useFavorites } from '../state/favorites-store'
import { useVault } from '../state/vault-store'
import treeStyles from './FileTree.module.css'
import styles from './Panels.module.css'
import { CanvasGlyph } from './ui/glyphs'

const label = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')

/** Aba "Favoritos": acesso rápido ao que foi marcado com estrela. */
export function FavoritesView() {
  const paths = useFavorites((s) => s.paths)
  const activePath = useVault((s) => s.activePath)

  if (!paths.length) {
    return (
      <div className={styles.scroll}>
        <div className={styles.hint}>
          Nenhum favorito ainda. Use a estrela no topo da nota, o menu do botão direito ou <code>Ctrl+P</code> → “favorito”.
        </div>
      </div>
    )
  }

  const open = (path: string, newTab: boolean) => {
    const vault = useVault.getState()
    if (/\.[a-z0-9]+$/i.test(path)) void vault.openFile(path, { newTab })
    else {
      // Pasta: revela na árvore de arquivos.
      const expanded = { ...vault.expanded }
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) expanded[parts.slice(0, i).join('/')] = true
      useVault.setState({ expanded })
      import('../state/workspace-store').then(({ useWorkspace }) => useWorkspace.getState().setLeftTab('files'))
    }
  }

  return (
    <div className={styles.scroll} role="tree" aria-label="Favoritos">
      {paths.map((path) => {
        const isFolder = !/\.[a-z0-9]+$/i.test(path)
        const kind = isFolder ? 'folder' : path.toLowerCase().endsWith('.md') ? 'note' : path.toLowerCase().endsWith('.canvas') ? 'canvas' : kindOf(path)
        const Icon = kind === 'folder' ? Folder : kind === 'note' ? FileText : kind === 'canvas' ? CanvasGlyph : File
        return (
          <div
            key={path}
            role="treeitem"
            tabIndex={0}
            className={treeStyles.row}
            data-active={activePath === path || undefined}
            style={{ paddingLeft: 10, gap: 8 }}
            title={path}
            onClick={(e) => open(path, e.ctrlKey || e.metaKey)}
            onKeyDown={(e) => e.key === 'Enter' && open(path, e.ctrlKey)}
          >
            <Icon size={14} className={styles.favIcon} />
            <span className={treeStyles.label}>{label(path)}</span>
            <button
              className={styles.favRemove}
              onClick={(e) => {
                e.stopPropagation()
                useFavorites.getState().toggle(path)
              }}
              title="Remover dos favoritos"
              aria-label={`Remover ${label(path)} dos favoritos`}
            >
              <Star size={13} fill="currentColor" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
