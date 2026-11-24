import { FilePlus, Files, FolderPlus, Hash, ListCollapse, Search, Star } from 'lucide-react'
import { FavoritesView } from './FavoritesView'
import { useVault } from '../state/vault-store'
import { type LeftTab, useWorkspace } from '../state/workspace-store'
import { FileTree } from './FileTree'
import { SearchView } from './SearchView'
import styles from './Sidebar.module.css'
import { TagsView } from './TagsView'
import { Resizer } from './ui/Resizer'

const TABS: Array<{ id: LeftTab; label: string; icon: typeof Files }> = [
  { id: 'files', label: 'Arquivos', icon: Files },
  { id: 'search', label: 'Busca (Ctrl+Shift+F)', icon: Search },
  { id: 'tags', label: 'Tags', icon: Hash },
  { id: 'favorites', label: 'Favoritos', icon: Star },
]

export function Sidebar() {
  const tab = useWorkspace((s) => s.leftTab)
  const setTab = useWorkspace((s) => s.setLeftTab)
  const createNote = useVault((s) => s.createNote)
  const createFolder = useVault((s) => s.createFolder)

  return (
    <aside className={styles.sidebar} aria-label="Barra lateral esquerda">
      <div className={styles.header}>
        <div className={styles.tabs} role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={styles.tab}
              data-active={tab === id || undefined}
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
            >
              <Icon size={15} strokeWidth={1.75} />
            </button>
          ))}
        </div>
        {tab === 'files' && (
          <div className={styles.tools}>
            <button className={styles.tool} onClick={() => void createNote()} title="Nova nota (Ctrl+N)" aria-label="Nova nota">
              <FilePlus size={15} strokeWidth={1.75} />
            </button>
            <button
              className={styles.tool}
              onClick={() => void createFolder()}
              title="Nova pasta (Ctrl+Shift+N)"
              aria-label="Nova pasta"
            >
              <FolderPlus size={15} strokeWidth={1.75} />
            </button>
            <button
              className={styles.tool}
              onClick={() => useVault.setState({ expanded: {} })}
              title="Recolher todas as pastas"
              aria-label="Recolher todas as pastas"
            >
              <ListCollapse size={15} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
      {tab === 'files' && <FileTree />}
      {tab === 'search' && <SearchView />}
      {tab === 'tags' && <TagsView />}
      {tab === 'favorites' && <FavoritesView />}
      <Resizer cssVar="--sidebar-w" side="left" fallback={264} />
    </aside>
  )
}
