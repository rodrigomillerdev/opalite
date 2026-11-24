import { useCallback } from 'react'
import styles from './Resizer.module.css'

/*
 * Alça para redimensionar uma barra lateral. A largura vive numa variável CSS
 * no <html> (nada de re-render durante o arraste) e é lembrada entre sessões.
 * Duplo clique volta ao padrão; setas do teclado ajustam de 16 em 16 px.
 */

interface Props {
  /** Variável CSS que guarda a largura, ex.: "--sidebar-w". */
  cssVar: string
  side: 'left' | 'right'
  min?: number
  max?: number
  fallback: number
}

const key = (cssVar: string) => `opalite:width${cssVar}`

export function restoreWidths(): void {
  for (const cssVar of ['--sidebar-w', '--rightbar-w']) {
    try {
      const v = Number(localStorage.getItem(key(cssVar)))
      if (v > 0) document.documentElement.style.setProperty(cssVar, `${v}px`)
    } catch {
      // sem armazenamento: usa o padrão
    }
  }
}

export function Resizer({ cssVar, side, min = 200, max = 520, fallback }: Props) {
  const current = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || fallback

  const apply = useCallback(
    (w: number | null) => {
      const root = document.documentElement.style
      try {
        if (w === null) {
          root.removeProperty(cssVar)
          localStorage.removeItem(key(cssVar))
        } else {
          const v = Math.round(Math.min(max, Math.max(min, w)))
          root.setProperty(cssVar, `${v}px`)
          localStorage.setItem(key(cssVar), String(v))
        }
      } catch {
        // sem armazenamento: vale só nesta sessão
      }
    },
    [cssVar, min, max],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = current()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    document.documentElement.classList.add('is-resizing')
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      apply(side === 'left' ? startW + dx : startW - dx)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      document.documentElement.classList.remove('is-resizing')
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
    if (e.key === grow) apply(current() + 16)
    else if (e.key === shrink) apply(current() - 16)
    else return
    e.preventDefault()
  }

  return (
    <div
      className={styles.handle}
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar barra lateral"
      tabIndex={0}
      title="Arraste para redimensionar · duplo clique para voltar ao padrão"
      onPointerDown={onPointerDown}
      onDoubleClick={() => apply(null)}
      onKeyDown={onKeyDown}
    />
  )
}
