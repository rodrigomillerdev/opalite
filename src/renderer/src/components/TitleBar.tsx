import { File, FileImage, FileText, FileType, HardDrive, PanelLeft, PanelRight, Plus, Square, X } from 'lucide-react'
import { CanvasGlyph, GraphGlyph } from './ui/glyphs'
import { kindOf } from '../lib/attachments'
import { useState } from 'react'
import { titleOf } from '../lib/paths'
import { type Tab, useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './TitleBar.module.css'
import { WindowControls } from './WindowControls'

export function tabLabel(tab: Tab): string {
  if (tab.kind === 'graph') return 'Visualização em gráfico'
  if (tab.kind === 'drive') return 'Arquivos'
  if (tab.kind === 'empty' || !tab.path) return 'Nova aba'
  const name = tab.path.slice(tab.path.lastIndexOf('/') + 1)
  if (tab.kind === 'file') return name
  return tab.kind === 'canvas' ? name.replace(/\.canvas$/i, '') : titleOf(tab.path)
}

const ICONS = { note: FileText, graph: GraphGlyph, canvas: CanvasGlyph, empty: Square, file: File, drive: HardDrive }

export function tabIcon(tab: Tab) {
  if (tab.kind !== 'file' || !tab.path) return ICONS[tab.kind]
  const k = kindOf(tab.path)
  return k === 'image' ? FileImage : k === 'pdf' || k === 'docx' ? FileType : File
}

/** Barra de título: alternar barras laterais, a fileira de abas e os botões da janela. */
export function TitleBar() {
  const sidebarOpen = useVault((s) => s.sidebarOpen)
  const rightOpen = useWorkspace((s) => s.rightOpen)
  const tabs = useVault((s) => s.tabs)
  const activeTabId = useVault((s) => s.activeTabId)
  const [dragId, setDragId] = useState<string | null>(null)

  return (
    <header className={styles.bar}>
      <button
        className={styles.iconButton}
        onClick={() => useVault.getState().toggleSidebar()}
        aria-label={sidebarOpen ? 'Ocultar barra lateral esquerda' : 'Mostrar barra lateral esquerda'}
        aria-pressed={sidebarOpen}
        title="Barra lateral esquerda (Ctrl+\)"
      >
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>

      <div className={styles.tabs} role="tablist" aria-label="Abas abertas">
        {tabs.map((tab, index) => {
          const Icon = tabIcon(tab)
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={styles.tab}
              data-active={active || undefined}
              data-dragging={dragId === tab.id || undefined}
              title={tab.path ?? tabLabel(tab)}
              draggable
              onDragStart={(e) => {
                setDragId(tab.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (!dragId || dragId === tab.id) return
                e.preventDefault()
                useVault.getState().moveTab(dragId, index)
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void useVault.getState().closeTab(tab.id)
                }
              }}
              onClick={() => void useVault.getState().activateTab(tab.id)}
            >
              <Icon size={13} strokeWidth={1.75} className={styles.tabIcon} />
              <span className={styles.tabLabel}>{tabLabel(tab)}</span>
              <button
                className={styles.tabClose}
                aria-label={`Fechar ${tabLabel(tab)}`}
                title="Fechar (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation()
                  void useVault.getState().closeTab(tab.id)
                }}
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            </div>
          )
        })}
        <button className={styles.newTab} onClick={() => void useVault.getState().newTab()} aria-label="Nova aba" title="Nova aba (Ctrl+T)">
          <Plus size={15} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.right}>
        <button
          className={styles.iconButton}
          onClick={() => useWorkspace.getState().toggleRight()}
          aria-label={rightOpen ? 'Ocultar barra lateral direita' : 'Mostrar barra lateral direita'}
          aria-pressed={rightOpen}
          title="Barra lateral direita (Ctrl+Shift+\)"
        >
          <PanelRight size={16} strokeWidth={1.75} />
        </button>
        <WindowControls />
      </div>
    </header>
  )
}
