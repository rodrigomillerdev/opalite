import { showToast } from './toast'

/*
 * Zoom da interface: Ctrl + (ou Ctrl =), Ctrl - e Ctrl 0. Funciona em todo o
 * app (notas, gráfico, editores de documento) e é lembrado entre sessões
 * pelo processo principal. Usa a tecla física (e.code) para funcionar em
 * teclados ABNT e no teclado numérico.
 */

export async function zoom(step: 1 | -1 | 0): Promise<void> {
  const factor = await window.opalite.ui.zoom(step)
  showToast(`Zoom: ${Math.round(factor * 100)}%`, { ms: 900 })
}

export function zoomKey(e: KeyboardEvent): 1 | -1 | 0 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') return 1
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') return -1
  if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0') return 0
  return null
}

/** Instala o atalho (fase de captura: vale também dentro dos editores). */
export function installZoomKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const step = zoomKey(e)
    if (step === null) return
    e.preventDefault()
    e.stopPropagation()
    void zoom(step)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
