import { useEffect, useState } from 'react'
import { type SaveState, useEditorStatus } from '../state/editor-status'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './StatusBar.module.css'

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saved: 'Salvo',
  dirty: 'Editando',
  saving: 'Salvando',
  error: 'Erro ao salvar',
  conflict: 'Conflito: escolha uma versão',
}

const numberFormat = new Intl.NumberFormat('pt-BR')

/** Barra de status: estado do salvamento, contagens e links de entrada da nota aberta. */
export function StatusBar() {
  const saveState = useEditorStatus((s) => s.saveState)
  const error = useEditorStatus((s) => s.error)
  const words = useEditorStatus((s) => s.words)
  const chars = useEditorStatus((s) => s.chars)
  const activePath = useVault((s) => s.activePath)
  const version = useIndex((s) => s.version)
  const [incoming, setIncoming] = useState<number | null>(null)
  const isNote = activePath !== null

  // Só a contagem de links (sem calcular menções soltas, que é caro).
  useEffect(() => {
    if (!activePath) return setIncoming(null)
    let cancelled = false
    const timer = setTimeout(() => {
      window.opalite.index
        .backlinks(activePath, { unlinked: false })
        .then((b) => !cancelled && setIncoming(b.linked.length))
        .catch(() => !cancelled && setIncoming(null))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activePath, version])

  return (
    <footer className={styles.bar}>
      <div className={styles.group}>
        {isNote && saveState !== 'idle' && (
          <span className={styles.save} data-state={saveState} title={error ?? undefined} aria-live="polite">
            <span className={styles.dot} aria-hidden="true" />
            {SAVE_LABEL[saveState]}
          </span>
        )}
      </div>
      {isNote && (
        <div className={styles.group}>
          {incoming !== null && (
            <button className={styles.link} onClick={() => useWorkspace.getState().setRightTab('backlinks')} title="Mostrar backlinks">
              {incoming} {incoming === 1 ? 'link de entrada' : 'links de entrada'}
            </button>
          )}
          <span>{numberFormat.format(words)} palavras</span>
          <span>{numberFormat.format(chars)} caracteres</span>
        </div>
      )}
    </footer>
  )
}
