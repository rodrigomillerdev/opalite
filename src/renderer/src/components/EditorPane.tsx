import { ArrowLeft, ArrowRight, History, ImagePlus, Star } from 'lucide-react'
import { useFavorites } from '../state/favorites-store'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import { openEditorMenu } from '../editor/context-menu'
import { documents } from '../editor/document-manager'
import { randomGradient } from '../lib/covers'
import { parentOf } from '../lib/paths'
import { useEditorStatus } from '../state/editor-status'
import { ConflictBar } from './ConflictBar'
import { NoteCover } from './NoteCover'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './EditorPane.module.css'
import { tabLabel } from './TitleBar'

// Gráfico e canvas só são carregados quando usados (abrir o app fica mais rápido).
const GraphView = lazy(() => import('./GraphView'))
const CanvasView = lazy(() => import('./CanvasView'))
const AttachmentView = lazy(() => import('./viewers/AttachmentView'))
const FileManager = lazy(() => import('./files/FileManager'))

export function EditorPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const tab = useVault((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const canBack = useVault((s) => s.back.length > 0)
  const canForward = useVault((s) => s.forward.length > 0)
  const isNote = tab?.kind === 'note'
  const hasCover = useEditorStatus((s) => Boolean(s.frontmatter['banner']))
  const favorite = useFavorites((s) => Boolean(tab?.path && s.paths.includes(tab.path)))

  // O CodeMirror é montado uma única vez; trocar de nota só troca o estado.
  useEffect(() => {
    if (!hostRef.current) return
    documents.attach(hostRef.current)
    return () => documents.detach()
  }, [])

  const folder = tab?.path ? parentOf(tab.path) : ''

  // Ao trocar de aba ou de nota, o conteúdo entra com uma animação curta
  // (reinicia a animação CSS removendo e recolocando a classe).
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.classList.remove(styles.enter!)
    void el.offsetWidth
    el.classList.add(styles.enter!)
  }, [tab?.id, tab?.path])

  return (
    <section className={styles.pane} aria-label="Conteúdo">
      <div className={styles.header}>
        <button className={styles.nav} onClick={() => void useVault.getState().goBack()} disabled={!canBack} aria-label="Voltar" title="Voltar (Ctrl+Alt+←)">
          <ArrowLeft size={16} strokeWidth={1.75} />
        </button>
        <button
          className={styles.nav}
          onClick={() => void useVault.getState().goForward()}
          disabled={!canForward}
          aria-label="Avançar"
          title="Avançar (Ctrl+Alt+→)"
        >
          <ArrowRight size={16} strokeWidth={1.75} />
        </button>
        <div className={styles.crumbs}>
          {folder && <span className={styles.crumb}>{folder.split('/').join(' / ')} /</span>}
          <span className={styles.crumbTitle}>{tab ? tabLabel(tab) : ''}</span>
        </div>
        {isNote && !hasCover && (
          <button className={styles.addCover} onClick={() => documents.updateFrontmatter({ banner: randomGradient() })} title="Adicionar uma capa à nota">
            <ImagePlus size={14} strokeWidth={1.75} /> Adicionar capa
          </button>
        )}
        {tab?.path && (
          <div className={styles.headerTools} data-pushed={!(isNote && !hasCover) || undefined}>
            <button className={styles.nav} onClick={() => useWorkspace.getState().openHistory(tab.path!)} title="Histórico de versões" aria-label="Histórico de versões">
              <History size={15} strokeWidth={1.75} />
            </button>
            <button
              className={styles.nav}
              data-on={favorite || undefined}
              onClick={() => useFavorites.getState().toggle(tab.path!)}
              title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              aria-label={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              aria-pressed={favorite}
            >
              <Star size={15} strokeWidth={1.75} fill={favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
        )}
      </div>

      {isNote && <ConflictBar />}
      <div ref={bodyRef} className={styles.body}>
      {isNote && <NoteCover hostRef={hostRef} />}
      <div
        ref={hostRef}
        className={styles.host}
        hidden={!isNote}
        // Sem preventDefault: o main precisa do evento nativo para as sugestões de ortografia.
        onContextMenu={(e) => {
          const view = documents.editorView
          void openEditorMenu(Boolean(view && !view.state.selection.main.empty), { x: e.clientX, y: e.clientY })
        }}
      />

      {tab?.kind === 'graph' && (
        <Suspense fallback={null}>
          <GraphView />
        </Suspense>
      )}
      {tab?.kind === 'canvas' && tab.path && (
        <Suspense fallback={null}>
          <CanvasView key={tab.path} path={tab.path} />
        </Suspense>
      )}
      {tab?.kind === 'file' && tab.path && (
        <Suspense fallback={null}>
          <AttachmentView key={tab.path} path={tab.path} />
        </Suspense>
      )}
      {tab?.kind === 'drive' && (
        <Suspense fallback={null}>
          <FileManager />
        </Suspense>
      )}
      {(!tab || tab.kind === 'empty') && <EmptyTab />}
      </div>
    </section>
  )
}

function EmptyTab() {
  const actions: Array<[string, string, () => void]> = [
    ['Criar nova nota', 'Ctrl N', () => void useVault.getState().createNote()],
    ['Ir para arquivo', 'Ctrl O', () => useWorkspace.getState().openModal('switcher')],
    ['Abrir visualização em gráfico', 'Ctrl G', () => void useVault.getState().openGraph()],
    ['Criar novo canvas', '', () => void useVault.getState().createCanvas()],
    ['Abrir nota diária', '', () => void useVault.getState().openDailyNote()],
    ['Converter PDF ou DOCX', '', () => useWorkspace.getState().openConverter()],
    ['Paleta de comandos', 'Ctrl P', () => useWorkspace.getState().openModal('palette')],
    ['Fechar aba', 'Ctrl W', () => void useVault.getState().closeTab()],
  ]
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>Nenhum arquivo aberto</p>
      <div className={styles.actions}>
        {actions.map(([label, keys, run]) => (
          <button key={label} className={styles.action} onClick={run}>
            <span>{label}</span>
            {keys && (
              <span className={styles.keys}>
                {keys.split(' ').map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
