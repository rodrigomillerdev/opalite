import { useEffect, useState } from 'react'
import styles from './TitleBar.module.css'

/*
 * Minimizar, maximizar/restaurar e fechar, desenhados pelo próprio app no
 * Windows e no Linux (no macOS ficam os botões nativos). Ficam dentro da
 * barra de título, no mesmo fluxo flex: herdam o fundo do tema (inclusive
 * gradiente e textura), a cor do texto e a altura da barra, e escalam junto
 * com o zoom da interface. Os traços são finos, como os do sistema.
 */

const isMac = navigator.userAgent.includes('Mac')

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return
    void window.opalite.ui.isMaximized().then(setMaximized, () => undefined)
    return window.opalite.ui.onMaximized(setMaximized)
  }, [])

  if (isMac) return null

  return (
    <div className={styles.windowControls}>
      <button className={styles.windowButton} onClick={() => void window.opalite.ui.minimize()} aria-label="Minimizar" title="Minimizar">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 5h9" />
        </svg>
      </button>
      <button
        className={styles.windowButton}
        onClick={() => void window.opalite.ui.toggleMaximize()}
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        title={maximized ? 'Restaurar' : 'Maximizar'}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V1.2c0-.4.3-.7.7-.7h5.6c.4 0 .7.3.7.7v5.6c0 .4-.3.7-.7.7H7.5" />
            <rect x="0.5" y="2.5" width="7" height="7" rx="0.7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" rx="0.8" />
          </svg>
        )}
      </button>
      <button
        className={`${styles.windowButton} ${styles.windowClose}`}
        onClick={() => void window.opalite.ui.close()}
        aria-label="Fechar"
        title="Fechar"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.8 0.8l8.4 8.4M9.2 0.8 0.8 9.2" />
        </svg>
      </button>
    </div>
  )
}
