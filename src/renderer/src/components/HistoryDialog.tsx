import { History, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VersionInfo } from '../../../shared/types'
import { formatBytes } from '../lib/attachments'
import { documents } from '../editor/document-manager'
import { flushAll, notify } from '../lib/flushers'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './HistoryDialog.module.css'

const TEXT = /\.(md|canvas|txt|csv)$/i

const when = (t: number) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t)

/** Histórico de versões de um arquivo: ver uma cópia antiga e restaurá-la. */
export function HistoryDialog() {
  const path = useWorkspace((s) => s.historyPath)
  const close = useWorkspace((s) => s.closeModal)
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [selected, setSelected] = useState<VersionInfo | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!path) return
    // Salva o que estiver pendente para a lista refletir o estado atual.
    void flushAll().then(() => window.opalite.history.list(path)).then((v) => {
      setVersions(v)
      setSelected(v[0] ?? null)
    }).catch(() => setVersions([]))
  }, [path])

  useEffect(() => {
    setPreview(null)
    if (!path || !selected || !TEXT.test(path)) return
    let cancelled = false
    void window.opalite.history.read(path, selected.id).then((bytes) => !cancelled && setPreview(new TextDecoder().decode(bytes)))
    return () => {
      cancelled = true
    }
  }, [path, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!path) return null
  const name = path.slice(path.lastIndexOf('/') + 1)

  const restore = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await flushAll()
      await window.opalite.history.restore(path, selected.id)
      // Recarrega a nota aberta com o conteúdo restaurado.
      if (path.toLowerCase().endsWith('.md')) await documents.externalChange(path)
      window.dispatchEvent(new CustomEvent('opalite:file-restored', { detail: { path } }))
      await useVault.getState().refreshTree()
      notify(`Versão de ${when(selected.time)} restaurada. A anterior ficou no histórico.`, 'notice')
      close()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.dialog} role="dialog" aria-label={`Histórico de ${name}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <History size={16} />
          <h3>
            Histórico de versões <span>{name}</span>
          </h3>
          <button className={styles.close} onClick={close} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className={styles.body}>
          <ul className={styles.list} role="listbox" aria-label="Versões">
            {versions === null && <li className={styles.empty}>Carregando…</li>}
            {versions?.length === 0 && (
              <li className={styles.empty}>
                Nenhuma versão guardada ainda. O Opalite guarda uma cópia antes de cada gravação de documentos e, nas notas, a cada 10 minutos de edição.
              </li>
            )}
            {versions?.map((v) => (
              <li key={v.id}>
                <button role="option" aria-selected={selected?.id === v.id} data-on={selected?.id === v.id || undefined} onClick={() => setSelected(v)}>
                  <strong>{when(v.time)}</strong>
                  <small>
                    {v.reason} · {formatBytes(v.size)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.preview}>
            {selected ? (
              preview !== null ? (
                <pre>{preview.slice(0, 20000)}</pre>
              ) : (
                <p className={styles.empty}>{TEXT.test(path) ? 'Carregando…' : 'Prévia indisponível para este formato. Restaure para abrir esta versão.'}</p>
              )
            ) : null}
          </div>
        </div>
        <footer className={styles.footer}>
          <span>A versão atual também fica guardada ao restaurar.</span>
          <button className={styles.primary} disabled={!selected || busy} onClick={() => void restore()}>
            <RotateCcw size={14} /> Restaurar esta versão
          </button>
        </footer>
      </div>
    </div>
  )
}
