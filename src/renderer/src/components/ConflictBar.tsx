import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { documents } from '../editor/document-manager'
import { useEditorStatus } from '../state/editor-status'
import { useVault } from '../state/vault-store'
import styles from './ConflictBar.module.css'

/**
 * Aparece quando a nota mudou fora do Opalite enquanto havia edição local.
 * O salvamento automático fica pausado até a pessoa escolher.
 */
export function ConflictBar() {
  const conflict = useEditorStatus((s) => s.saveState === 'conflict')
  const [busy, setBusy] = useState(false)
  if (!conflict) return null

  const resolve = async (choice: 'mine' | 'disk' | 'copy') => {
    setBusy(true)
    try {
      const copy = await documents.resolveConflict(choice)
      await useVault.getState().refreshTree()
      if (copy) useVault.getState().notify(`Sua versão foi guardada em "${copy.slice(copy.lastIndexOf('/') + 1, -3)}"`)
    } catch (err) {
      useVault.setState({ error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.bar} role="alert">
      <TriangleAlert size={16} strokeWidth={1.75} className={styles.icon} />
      <div className={styles.text}>
        <strong>Esta nota mudou fora do Opalite</strong>
        <span>Suas alterações não foram salvas por cima. Escolha qual versão manter.</span>
      </div>
      <div className={styles.actions}>
        <button disabled={busy} onClick={() => void resolve('copy')} title="Guarda sua versão numa nota nova e carrega a do disco">
          Guardar a minha como cópia
        </button>
        <button disabled={busy} onClick={() => void resolve('disk')}>
          Usar a do disco
        </button>
        <button disabled={busy} className={styles.primary} onClick={() => void resolve('mine')}>
          Manter a minha
        </button>
      </div>
    </div>
  )
}
