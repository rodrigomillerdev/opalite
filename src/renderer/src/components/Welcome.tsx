import { FolderOpen, FolderPlus } from 'lucide-react'
import { useVault } from '../state/vault-store'
import { OpalMark } from './OpalMark'
import styles from './Welcome.module.css'

export function Welcome() {
  const recent = useVault((s) => s.recent)
  const pickVault = useVault((s) => s.pickVault)
  const openRecent = useVault((s) => s.openRecent)

  return (
    <div className={styles.screen}>
      <div className={styles.dragBar} />
      <main className={styles.panel}>
        <div className={styles.brand}>
          <OpalMark size={76} glow />
          <h1 className={styles.title}>Opalite</h1>
          <p className={styles.tagline}>Suas notas em Markdown, guardadas em uma pasta sua.</p>
        </div>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => void pickVault('open')}>
            <FolderOpen size={16} strokeWidth={1.75} />
            Abrir pasta como cofre
          </button>
          <button className={styles.secondary} onClick={() => void pickVault('create')}>
            <FolderPlus size={16} strokeWidth={1.75} />
            Criar novo cofre
          </button>
        </div>

        {recent.length > 0 && (
          <section className={styles.recent} aria-labelledby="recent-title">
            <h2 id="recent-title" className={styles.recentTitle}>
              Recentes
            </h2>
            <ul className={styles.recentList}>
              {recent.map((v) => (
                <li key={v.root}>
                  <button className={styles.recentItem} onClick={() => void openRecent(v.root)}>
                    <span className={styles.recentName}>{v.name}</span>
                    <span className={styles.recentPath}>{v.root}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
