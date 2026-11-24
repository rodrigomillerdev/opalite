import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SLIDE_H, SLIDE_W, type Slide } from '../../lib/office/presentation'
import styles from './PresentationEditor.module.css'
import { SlideView } from './slide-render'

/*
 * Modo apresentação: ocupa a tela inteira (Fullscreen API), fundo preto e só
 * o slide, escalado para caber sem distorcer. Avança com →, ↓, Espaço,
 * Enter, PageDown ou clique; volta com ←, ↑, Backspace, PageUp ou botão
 * direito; Home/End vão ao primeiro/último; Esc sai. Depois do último slide
 * aparece uma tela de fim, e mais um avanço encerra.
 *
 * O componente é montado uma única vez por apresentação: as funções do pai
 * ficam em refs, para que uma nova renderização do editor (por exemplo, a
 * barra de título reagindo à tela cheia) não desmonte nem saia da tela cheia.
 */

export function SlidePresenter({ slides, start, onExit }: { slides: Slide[]; start: number; onExit(index: number): void }) {
  const [i, setI] = useState(() => Math.max(0, Math.min(start, slides.length - 1)))
  const [dir, setDir] = useState<1 | -1>(1)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [chrome, setChrome] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const state = useRef({ i, total: slides.length, exited: false, onExit })
  state.current.i = i
  state.current.total = slides.length
  state.current.onExit = onExit
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ended = i >= slides.length

  const exit = () => {
    const s = state.current
    if (s.exited) return
    s.exited = true
    s.onExit(Math.min(s.i, s.total - 1))
  }

  const go = (d: 1 | -1) => {
    const { i: cur, total } = state.current
    if (d === 1 && cur >= total) return exit()
    setDir(d)
    setI(Math.max(0, Math.min(total, cur + d)))
  }

  /** Mostra o indicador e o cursor por alguns segundos. */
  const poke = () => {
    setChrome(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChrome(false), 2200)
  }

  // Entra em tela cheia uma vez; sair dela (Esc do sistema, F11) encerra a apresentação.
  useEffect(() => {
    const el = ref.current
    let entered = false
    const onFs = () => {
      if (document.fullscreenElement) entered = true
      else if (entered) exit()
    }
    document.addEventListener('fullscreenchange', onFs)
    el?.focus({ preventScroll: true })
    if (el && !document.fullscreenElement) void el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined)
    poke()
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escala: o slide inteiro cabe na tela, mantendo 16:9.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const key = e.key
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(key)) go(1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(key)) go(-1)
      else if (key === 'Home') setI(0)
      else if (key === 'End') setI(state.current.total - 1)
      else if (key === 'Escape') exit()
      else if (key !== 'F5' && key !== 'F11') return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // O indicador reaparece rapidamente a cada troca de slide.
  useEffect(poke, [i])

  const scale = Math.min(size.w / SLIDE_W, size.h / SLIDE_H)
  const slide = slides[Math.min(i, slides.length - 1)]

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      className={styles.presenter}
      data-idle={!chrome || undefined}
      role="dialog"
      aria-label="Apresentação"
      onClick={() => go(1)}
      onContextMenu={(e) => {
        e.preventDefault()
        go(-1)
      }}
      onMouseMove={poke}
    >
      {ended || !slide ? (
        <div className={styles.presentEnd}>
          <p>Fim da apresentação</p>
          <span>Clique ou pressione Esc para sair</span>
        </div>
      ) : (
        <div key={slide.id} className={styles.presentSlide} data-dir={dir} style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
          <SlideView slide={slide} scale={scale} />
        </div>
      )}
      <div className={styles.presentBar} data-show={chrome || undefined} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        <button onClick={() => go(-1)} disabled={i === 0} aria-label="Slide anterior" title="Anterior (←)">
          <ChevronLeft size={16} />
        </button>
        <span aria-live="polite">{ended ? 'Fim' : `Slide ${i + 1} de ${slides.length}`}</span>
        <button onClick={() => go(1)} aria-label="Próximo slide" title="Próximo (→ ou Espaço)">
          <ChevronRight size={16} />
        </button>
        <span className={styles.presentSep} />
        <button onClick={exit} aria-label="Sair da apresentação" title="Sair (Esc)">
          <X size={15} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
