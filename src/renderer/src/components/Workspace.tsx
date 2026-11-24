import { Suspense, lazy, useEffect } from 'react'
import { handleGlobalKey } from '../lib/commands'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import { CommandPalette } from './CommandPalette'
import { DropLayer } from './DropLayer'
import { EditorPane } from './EditorPane'
import { QuickSwitcher } from './QuickSwitcher'
import { Ribbon } from './Ribbon'
import { RightSidebar } from './RightSidebar'
import { HoverPreview } from './HoverPreview'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TemplatePicker } from './TemplatePicker'
import { TitleBar } from './TitleBar'
import styles from './Workspace.module.css'

// Diálogos carregam só quando abertos (menos código na abertura do app).
const Converter = lazy(() => import('./Converter').then((m) => ({ default: m.Converter })))
const HistoryDialog = lazy(() => import('./HistoryDialog').then((m) => ({ default: m.HistoryDialog })))
const ThemeStudio = lazy(() => import('./ThemeStudio').then((m) => ({ default: m.ThemeStudio })))
const SettingsDialog = lazy(() => import('./SettingsDialog').then((m) => ({ default: m.SettingsDialog })))
const ThemeEditor = lazy(() => import('./ThemeEditor').then((m) => ({ default: m.ThemeEditor })))

export function Workspace() {
  const sidebarOpen = useVault((s) => s.sidebarOpen)
  const rightOpen = useWorkspace((s) => s.rightOpen)
  const modal = useWorkspace((s) => s.modal)

  // Atalhos globais vêm do registro de comandos (lib/commands.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useWorkspace.getState().modal) return
      handleGlobalKey(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={styles.workspace}>
      <TitleBar />
      <div className={styles.body}>
        <Ribbon />
        {sidebarOpen && <Sidebar />}
        <EditorPane />
        {rightOpen && <RightSidebar />}
      </div>
      <StatusBar />
      {modal === 'palette' && <CommandPalette />}
      {modal === 'switcher' && <QuickSwitcher />}
      {modal === 'template' && <TemplatePicker />}
      <Suspense fallback={null}>
        {modal === 'theme' && <ThemeEditor />}
        {modal === 'converter' && <Converter />}
        {modal === 'settings' && <SettingsDialog />}
        {modal === 'history' && <HistoryDialog />}
        {modal === 'studio' && <ThemeStudio />}
      </Suspense>
      <DropLayer />
      <HoverPreview />
    </div>
  )
}
