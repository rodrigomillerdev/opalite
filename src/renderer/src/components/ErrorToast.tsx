import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useEffect } from 'react'
import { useVault } from '../state/vault-store'
import styles from './ErrorToast.module.css'

/** Avisos passageiros: erros (vermelho) e confirmações (cor de destaque). */
export function ErrorToast() {
  const error = useVault((s) => s.error)
  const notice = useVault((s) => s.notice)
  const dismiss = useVault((s) => s.dismissError)
  const message = error ?? notice

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(dismiss, error ? 6000 : 3500)
    return () => clearTimeout(timer)
  }, [message, error, dismiss])

  if (!message) return null
  const Icon = error ? CircleAlert : CircleCheck
  return (
    <div className={styles.toast} role={error ? 'alert' : 'status'} data-kind={error ? 'error' : 'notice'} key={message}>
      <Icon size={15} strokeWidth={1.75} className={styles.icon} />
      <span className={styles.text}>{message}</span>
      <button className={styles.close} onClick={dismiss} aria-label="Fechar aviso">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}
