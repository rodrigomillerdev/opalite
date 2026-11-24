import { ArrowUpRight, CalendarDays, ChevronRight, Link2, ListTree } from 'lucide-react'
import { GraphGlyph } from './ui/glyphs'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { Backlinks, MentionGroup } from '../../../shared/types'
import { documents } from '../editor/document-manager'
import { useEditorStatus } from '../state/editor-status'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import { type RightTab, useWorkspace } from '../state/workspace-store'
import { CalendarView } from './CalendarView'
import styles from './Panels.module.css'
import { Resizer } from './ui/Resizer'
import sidebar from './Sidebar.module.css'

const GraphView = lazy(() => import('./GraphView'))

const TABS: Array<{ id: RightTab; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = [
  { id: 'backlinks', label: 'Backlinks', icon: Link2 },
  { id: 'outgoing', label: 'Links de saída', icon: ArrowUpRight },
  { id: 'graph', label: 'Gráfico local', icon: GraphGlyph },
  { id: 'outline', label: 'Estrutura', icon: ListTree },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
]

export function RightSidebar() {
  const tab = useWorkspace((s) => s.rightTab)
  const setTab = useWorkspace((s) => s.setRightTab)
  const activePath = useVault((s) => s.activePath)

  return (
    <aside className={`${sidebar.sidebar} ${sidebar.right}`} style={{ borderRight: 0, borderLeft: '1px solid var(--border)' }} aria-label="Barra lateral direita">
      <div className={sidebar.header}>
        <div className={sidebar.tabs} role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={sidebar.tab}
              data-active={tab === id || undefined}
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
            >
              <Icon size={15} strokeWidth={1.75} />
            </button>
          ))}
        </div>
        <span className={styles.count} style={{ fontSize: 'var(--text-xs)', paddingRight: 6 }}>
          {TABS.find((t) => t.id === tab)?.label}
        </span>
      </div>
      {tab === 'calendar' ? (
        <CalendarView />
      ) : tab === 'graph' ? (
        <Suspense fallback={null}>
          <GraphView local />
        </Suspense>
      ) : !activePath ? (
        <div className={styles.scroll}>
          <div className={styles.hint}>Abra uma nota para ver as conexões dela.</div>
        </div>
      ) : tab === 'backlinks' ? (
        <BacklinksView path={activePath} />
      ) : tab === 'outgoing' ? (
        <OutgoingView path={activePath} />
      ) : (
        <OutlineView />
      )}
      <Resizer cssVar="--rightbar-w" side="right" fallback={280} min={220} max={560} />
    </aside>
  )
}

async function openAt(path: string, line?: number): Promise<void> {
  await useVault.getState().openFile(path)
  if (line !== undefined) documents.revealLine(line)
}

function BacklinksView({ path }: { path: string }) {
  const version = useIndex((s) => s.version)
  const [data, setData] = useState<Backlinks | null>(null)
  const [showUnlinked, setShowUnlinked] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Menções soltas exigem varrer o texto de todas as notas: só quando a seção está aberta.
    const timer = setTimeout(() => {
      window.opalite.index
        .backlinks(path, { unlinked: showUnlinked })
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData({ linked: [], unlinked: [] }))
    }, data ? 120 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, showUnlinked])

  const count = (groups: MentionGroup[]) => groups.reduce((n, g) => n + g.mentions.length, 0)

  const link = async (source: string, from: number, to: number) => {
    try {
      await documents.flush()
      await window.opalite.index.linkMention(source, from, to, path)
    } catch (err) {
      useVault.setState({ error: (err as Error).message })
    }
  }

  if (!data) return <div className={styles.scroll} />

  return (
    <div className={styles.scroll}>
      <div className={styles.sectionTitle}>
        <span>Menções vinculadas</span>
        <span className={styles.count}>{count(data.linked)}</span>
      </div>
      {data.linked.length === 0 && <div className={styles.hint}>Nenhuma nota tem link para esta.</div>}
      {data.linked.map((g) => (
        <div key={g.path} className={styles.group}>
          <button className={styles.groupTitle} onClick={() => void openAt(g.path, g.mentions[0]?.line)} title={g.path}>
            <span>{g.title}</span>
            <span className={styles.count}>{g.mentions.length}</span>
          </button>
          {g.mentions.map((m) => (
            <button key={m.from} className={styles.snippet} onClick={() => void openAt(g.path, m.line)}>
              {m.text}
            </button>
          ))}
        </div>
      ))}

      <div className={styles.sectionTitle}>
        <button className={styles.sectionButton} onClick={() => setShowUnlinked((v) => !v)} aria-expanded={showUnlinked}>
          <ChevronRight size={12} strokeWidth={2} style={{ transform: showUnlinked ? 'rotate(90deg)' : undefined }} />
          Menções não vinculadas
        </button>
        <span className={styles.count}>{showUnlinked ? count(data.unlinked) : ''}</span>
      </div>
      {showUnlinked && data.unlinked.length === 0 && (
        <div className={styles.hint}>O título desta nota não aparece solto em outras notas.</div>
      )}
      {showUnlinked &&
        data.unlinked.map((g) => (
          <div key={g.path} className={styles.group}>
            <button className={styles.groupTitle} onClick={() => void openAt(g.path, g.mentions[0]?.line)} title={g.path}>
              <span>{g.title}</span>
              <span className={styles.count}>{g.mentions.length}</span>
            </button>
            {g.mentions.map((m) => (
              <div key={m.from} className={styles.mentionRow}>
                <button className={styles.snippet} onClick={() => void openAt(g.path, m.line)}>
                  {m.text}
                </button>
                <button className={styles.linkButton} onClick={() => void link(g.path, m.from, m.to)} title="Transformar em [[link]]">
                  Vincular
                </button>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

function OutgoingView({ path }: { path: string }) {
  const links = useEditorStatus((s) => s.links)
  const resolver = useIndex((s) => s.resolver)

  const { existing, missing } = useMemo(() => {
    const existing = new Map<string, { title: string; line: number }>()
    const missing = new Map<string, number>()
    for (const l of links) {
      if (!l.target) continue
      const resolved = resolver.resolve(l.target, path)
      if (resolved) {
        if (!existing.has(resolved)) existing.set(resolved, { title: resolved.slice(resolved.lastIndexOf('/') + 1, -3), line: l.line })
      } else if (!missing.has(l.target)) missing.set(l.target, l.line)
    }
    return { existing: [...existing], missing: [...missing] }
  }, [links, resolver, path])

  return (
    <div className={styles.scroll}>
      <div className={styles.sectionTitle}>
        <span>Links</span>
        <span className={styles.count}>{existing.length}</span>
      </div>
      {existing.length === 0 && <div className={styles.hint}>Esta nota não tem links para outras notas.</div>}
      {existing.map(([target, { title }]) => (
        <button key={target} className={styles.row} onClick={() => void openAt(target)} title={target}>
          <span>{title}</span>
        </button>
      ))}
      {missing.length > 0 && (
        <>
          <div className={styles.sectionTitle}>
            <span>Notas ainda não criadas</span>
            <span className={styles.count}>{missing.length}</span>
          </div>
          {missing.map(([target]) => (
            <button
              key={target}
              className={`${styles.row} ${styles.missing}`}
              onClick={() => void useVault.getState().openLink(target, null)}
              title="Clique para criar"
            >
              <span>{target}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function OutlineView() {
  const headings = useEditorStatus((s) => s.headings)
  if (headings.length === 0) {
    return (
      <div className={styles.scroll}>
        <div className={styles.hint}>
          Sem títulos. Comece uma linha com <code>#</code> para criar um.
        </div>
      </div>
    )
  }
  const minLevel = Math.min(...headings.map((h) => h.level))
  return (
    <nav className={styles.scroll} aria-label="Estrutura da nota">
      {headings.map((h) => (
        <button
          key={`${h.line}`}
          className={styles.outline}
          data-level={h.level - minLevel + 1}
          style={{ paddingLeft: 6 + (h.level - minLevel) * 14 }}
          onClick={() => documents.revealLine(h.line)}
        >
          {h.text}
        </button>
      ))}
    </nav>
  )
}
