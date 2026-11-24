import { Check, CircleAlert, ExternalLink, FolderOpen, History, Loader2, type LucideIcon } from 'lucide-react'
import { useRef } from 'react'
import { useVault } from '../../state/vault-store'
import { useWorkspace } from '../../state/workspace-store'
import styles from './OfficeShell.module.css'
import { SAVE_LABEL, type SaveState } from './useOfficeFile'

/** Moldura comum: barra de ferramentas, área de trabalho e barra de status. */
export function OfficeShell({
  path,
  state,
  loading,
  toolbar,
  status,
  children,
}: {
  path: string
  state: SaveState
  loading?: boolean
  toolbar: React.ReactNode
  status?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={styles.shell}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatação" onMouseDown={(e) => (e.target as HTMLElement).closest('button') && e.preventDefault()}>
        {toolbar}
      </div>
      <div className={styles.body}>{loading ? <div className={styles.loading}><Loader2 size={20} className={styles.spin} /> Abrindo…</div> : children}</div>
      <footer className={styles.status}>
        <span className={styles.save} data-state={state}>
          {state === 'saving' ? <Loader2 size={12} className={styles.spin} /> : state === 'error' ? <CircleAlert size={12} /> : state === 'saved' ? <Check size={12} /> : <span className={styles.dot} />}
          {SAVE_LABEL[state]}
        </span>
        {status}
        <span className={styles.actions}>
          <button onClick={() => useWorkspace.getState().openHistory(path)} title="Histórico de versões" aria-label="Histórico de versões">
            <History size={13} />
          </button>
          <button onClick={() => void useVault.getState().reveal(path)} title="Mostrar no explorador" aria-label="Mostrar no explorador">
            <FolderOpen size={13} />
          </button>
          <button onClick={() => void window.opalite.files.openExternal(path)} title="Abrir no aplicativo padrão" aria-label="Abrir no aplicativo padrão">
            <ExternalLink size={13} />
          </button>
        </span>
      </footer>
    </div>
  )
}

export function ToolButton({ icon: Icon, label, on, disabled, onClick }: { icon: LucideIcon | React.ComponentType<{ size?: number }>; label: string; on?: boolean; disabled?: boolean; onClick(e: React.MouseEvent<HTMLButtonElement>): void }) {
  return (
    <button className={styles.tool} data-on={on || undefined} disabled={disabled} onClick={onClick} title={label} aria-label={label} aria-pressed={on}>
      <Icon size={16} />
    </button>
  )
}

/** Botão de cor: clique aplica a última cor; a faixa abaixo abre o seletor. */
export function ColorButton({ icon: Icon, label, initial, onPick }: { icon: LucideIcon; label: string; initial: string; onPick(color: string): void }) {
  const input = useRef<HTMLInputElement>(null)
  const last = useRef(initial)
  return (
    <span className={styles.color}>
      <button className={styles.tool} onClick={() => onPick(last.current)} title={label} aria-label={label}>
        <Icon size={16} />
        <span className={styles.swatch} style={{ background: last.current }} />
      </button>
      <button className={styles.caret} onClick={() => input.current?.click()} title={`${label}: escolher cor`} aria-label={`${label}: escolher cor`}>
        ▾
      </button>
      <input
        ref={input}
        type="color"
        defaultValue={initial}
        tabIndex={-1}
        className={styles.hiddenColor}
        onChange={(e) => {
          last.current = e.target.value
          const sw = e.target.parentElement?.querySelector<HTMLElement>(`.${styles.swatch}`)
          if (sw) sw.style.background = e.target.value
          onPick(e.target.value)
        }}
      />
    </span>
  )
}

export const Divider = () => <span className={styles.divider} aria-hidden="true" />
