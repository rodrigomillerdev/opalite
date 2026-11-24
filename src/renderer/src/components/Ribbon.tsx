import { CalendarCheck, FileOutput, HardDrive, Palette, Search, Settings, SquareTerminal } from 'lucide-react'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './Ribbon.module.css'
import { CanvasGlyph, GemGlyph, GraphGlyph } from './ui/glyphs'

interface RibbonAction {
  label: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  active?: boolean
  run(): void
}

/**
 * Barra vertical de ações: só o que é usado com frequência e não tem outro
 * lugar óbvio. O resto fica na paleta de comandos (Ctrl+P).
 */
export function Ribbon() {
  const activeKind = useVault((s) => s.tabs.find((t) => t.id === s.activeTabId)?.kind)
  const vaultName = useVault((s) => s.vault?.name ?? '')

  const top: RibbonAction[] = [
    { label: 'Buscar e abrir nota (Ctrl+O)', icon: Search, run: () => useWorkspace.getState().openModal('switcher') },
    { label: 'Visualização em gráfico (Ctrl+G)', icon: GraphGlyph, active: activeKind === 'graph', run: () => void useVault.getState().openGraph() },
    { label: 'Novo canvas', icon: CanvasGlyph, active: activeKind === 'canvas', run: () => void useVault.getState().createCanvas() },
    { label: 'Arquivos (Ctrl+Shift+E)', icon: HardDrive, active: activeKind === 'drive', run: () => void useVault.getState().openDrive() },
    { label: 'Nota diária de hoje', icon: CalendarCheck, run: () => void useVault.getState().openDailyNote() },
    { label: 'Converter PDF ⇄ DOCX', icon: FileOutput, run: () => useWorkspace.getState().openConverter() },
    { label: 'Paleta de comandos (Ctrl+P)', icon: SquareTerminal, run: () => useWorkspace.getState().openModal('palette') },
  ]
  const bottom: RibbonAction[] = [
    { label: 'Tema e cores', icon: Palette, run: () => useWorkspace.getState().openModal('theme') },
    { label: 'Configurações (Ctrl+,)', icon: Settings, run: () => useWorkspace.getState().openModal('settings') },
    { label: `Trocar de cofre (atual: ${vaultName})`, icon: GemGlyph, run: () => void useVault.getState().closeVault() },
  ]

  const render = (a: RibbonAction) => (
    <button key={a.label} className={styles.button} data-active={a.active || undefined} onClick={a.run} title={a.label} aria-label={a.label}>
      <a.icon size={18} />
    </button>
  )

  return (
    <nav className={styles.ribbon} aria-label="Ações rápidas">
      <div className={styles.group}>{top.map(render)}</div>
      <div className={styles.group}>{bottom.map(render)}</div>
    </nav>
  )
}
