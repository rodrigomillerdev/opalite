import mark from '../assets/opalite-mark.png'
import styles from './OpalMark.module.css'

/**
 * Marca do Opalite: a pedra lapidada do ícone do app, com fundo transparente
 * (gerada por "npm run brand:icons" a partir de assets/brand/opalite-icon-source.jpg).
 * `glow` acrescenta um brilho suave em volta, para a tela inicial.
 */
export function OpalMark({ size = 20, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <img
      src={mark}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={glow ? `${styles.mark} ${styles.glow}` : styles.mark}
    />
  )
}
