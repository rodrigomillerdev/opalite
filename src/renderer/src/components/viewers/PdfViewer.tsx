import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, FileOutput, Maximize, Minus, Plus, ScrollText } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PageCache, type PDFDocumentProxy, openPdf } from '../../lib/pdf'
import { useWorkspace } from '../../state/workspace-store'
import styles from './PdfViewer.module.css'

/*
 * Leitor de PDF com dois modos:
 * - Livro: páginas lado a lado (a capa sozinha à direita, como num livro) e
 *   animação 3D de virar a página. Clique na página da direita (ou seta →)
 *   para avançar e na da esquerda (←) para voltar.
 * - Rolagem: páginas em coluna, desenhadas só quando aparecem na tela.
 */

type Mode = 'book' | 'scroll'
type Spread = [number | null, number | null]
type Anim = { dir: 'next' | 'prev'; from: number; to: number }

const FLIP_MS = 640
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function spreadPages(s: number, count: number, twoUp: boolean): Spread {
  if (!twoUp) return [s < count ? s : null, null]
  if (s === 0) return [null, 0]
  const left = 2 * s - 1
  return [left < count ? left : null, left + 1 < count ? left + 1 : null]
}

function spreadOfPage(page: number, twoUp: boolean): number {
  return twoUp ? (page === 0 ? 0 : Math.ceil(page / 2)) : page
}

function spreadCount(count: number, twoUp: boolean): number {
  return twoUp ? Math.floor(count / 2) + 1 : count
}

export default function PdfViewer({ path }: { path: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aspect, setAspect] = useState(0.707)
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('opalite:pdf-mode') as Mode) || 'book')
  const [zoom, setZoom] = useState(1)
  const [spread, setSpread] = useState(0)
  const [anim, setAnim] = useState<Anim | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [scrollPage, setScrollPage] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const cache = useRef<PageCache | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setDoc(null)
    setError(null)
    window.opalite.files
      .readBinary(path)
      .then((bytes) => openPdf(bytes))
      .then(async (d) => {
        loaded = d
        if (cancelled) return void d.destroy()
        const first = await d.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        setAspect(vp.width / vp.height)
        cache.current = new PageCache(d)
        setDoc(d)
        setSpread(0)
      })
      .catch((err: Error) => !cancelled && setError(`Não foi possível abrir o PDF: ${err.message}`))
    return () => {
      cancelled = true
      cache.current?.clear()
      void loaded?.destroy()
    }
  }, [path])

  useEffect(() => {
    try {
      localStorage.setItem('opalite:pdf-mode', mode)
    } catch {
      // sem armazenamento
    }
  }, [mode])

  // Tamanho disponível acompanha a janela.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => ro.disconnect()
  }, [doc, mode])

  const count = doc?.numPages ?? 0
  // Duas páginas lado a lado quando a área é mais larga que alta (como um livro aberto).
  const twoUp = count > 1 && box.w > 700 && box.w / Math.max(1, box.h) > 1.15
  const pad = 48
  // Altura da página que cabe na tela (modo livro) multiplicada pelo zoom.
  const fitH = Math.max(120, Math.min(box.h - pad, ((twoUp ? box.w / 2 : box.w) - pad) / aspect))
  const pageW = Math.round(fitH * aspect * zoom)
  const pageH = Math.round(fitH * zoom)
  const scrollW = Math.round(Math.min(box.w - pad, 900) * zoom)

  const total = spreadCount(count, twoUp)
  const current = spreadPages(spread, count, twoUp)
  const firstVisible = mode === 'scroll' ? scrollPage : (current[0] ?? current[1] ?? 0)

  // Ao mudar entre uma e duas páginas, mantém a página atual visível.
  const lastTwoUp = useRef(twoUp)
  useEffect(() => {
    if (lastTwoUp.current === twoUp) return
    const page = spreadPages(spread, count, lastTwoUp.current)
    lastTwoUp.current = twoUp
    setSpread(spreadOfPage(page[0] ?? page[1] ?? 0, twoUp))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoUp])

  // Pré-desenha as páginas vizinhas para a virada não esperar.
  useEffect(() => {
    if (!doc || mode !== 'book' || !pageW) return
    for (const s of [spread - 1, spread + 1, spread + 2]) {
      if (s < 0 || s >= total) continue
      for (const p of spreadPages(s, count, twoUp)) if (p !== null) void cache.current?.get(p, pageW)
    }
  }, [doc, spread, pageW, twoUp, total, count, mode])

  const go = useCallback(
    (dir: 'next' | 'prev') => {
      if (anim || !doc) return
      const to = dir === 'next' ? spread + 1 : spread - 1
      if (to < 0 || to >= total) return
      if (reducedMotion()) return setSpread(to)
      setAnim({ dir, from: spread, to })
    },
    [anim, doc, spread, total],
  )

  const goToPage = (page: number) => {
    const p = Math.max(0, Math.min(count - 1, page))
    if (mode === 'scroll') {
      stageRef.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' })
    } else {
      setAnim(null)
      setSpread(spreadOfPage(p, twoUp))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (mode === 'book') {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) (e.preventDefault(), go('next'))
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) (e.preventDefault(), go('prev'))
      else if (e.key === 'Home') goToPage(0)
      else if (e.key === 'End') goToPage(count - 1)
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) (e.preventDefault(), setZoom((z) => Math.min(3, z + 0.15)))
    if ((e.ctrlKey || e.metaKey) && e.key === '-') (e.preventDefault(), setZoom((z) => Math.max(0.4, z - 0.15)))
  }

  if (error) return <div className={styles.message}>{error}</div>

  return (
    <div className={styles.viewer} tabIndex={0} onKeyDown={onKeyDown} aria-label={`PDF ${path}`}>
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="radiogroup" aria-label="Modo de leitura">
          <button role="radio" aria-checked={mode === 'book'} data-on={mode === 'book' || undefined} onClick={() => setMode('book')} title="Livro">
            <BookOpen size={14} strokeWidth={1.75} /> Livro
          </button>
          <button role="radio" aria-checked={mode === 'scroll'} data-on={mode === 'scroll' || undefined} onClick={() => setMode('scroll')} title="Rolagem contínua">
            <ScrollText size={14} strokeWidth={1.75} /> Rolagem
          </button>
        </div>

        <div className={styles.pager}>
          <button onClick={() => (mode === 'book' ? go('prev') : goToPage(firstVisible - 1))} disabled={firstVisible <= 0} aria-label="Página anterior" title="Anterior (←)">
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <input
            key={firstVisible}
            className={styles.pageInput}
            defaultValue={count ? firstVisible + 1 : ''}
            aria-label="Página"
            inputMode="numeric"
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToPage(Number(e.currentTarget.value) - 1)
            }}
            onBlur={(e) => goToPage(Number(e.currentTarget.value) - 1)}
          />
          <span className={styles.count}>de {count || '…'}</span>
          <button
            onClick={() => (mode === 'book' ? go('next') : goToPage(firstVisible + 1))}
            disabled={mode === 'book' ? spread >= total - 1 : firstVisible >= count - 1}
            aria-label="Próxima página"
            title="Próxima (→)"
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.actions}>
          <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))} aria-label="Diminuir zoom" title="Diminuir (Ctrl −)">
            <Minus size={15} strokeWidth={1.75} />
          </button>
          <button className={styles.zoomLabel} onClick={() => setZoom(1)} title="Ajustar à tela">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} aria-label="Aumentar zoom" title="Aumentar (Ctrl +)">
            <Plus size={15} strokeWidth={1.75} />
          </button>
          <button onClick={() => setZoom(1)} aria-label="Ajustar à tela" title="Ajustar à tela">
            <Maximize size={14} strokeWidth={1.75} />
          </button>
          <span className={styles.sep} />
          <button className={styles.wide} onClick={() => useWorkspace.getState().openConverter(path)} title="Converter este PDF para Word (.docx)">
            <FileOutput size={14} strokeWidth={1.75} /> <span className={styles.wideLabel}>Converter para DOCX</span>
          </button>
          <button onClick={() => void window.opalite.files.openExternal(path)} aria-label="Abrir no aplicativo padrão" title="Abrir no aplicativo padrão">
            <ExternalLink size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div ref={stageRef} className={styles.stage} data-mode={mode}>
        {!doc && <div className={styles.loading}>Abrindo PDF…</div>}
        {doc && mode === 'book' && box.w > 0 && (
          <Book
            cache={cache.current!}
            count={count}
            spread={spread}
            twoUp={twoUp}
            anim={anim}
            pageW={pageW}
            pageH={pageH}
            onFlipEnd={(to) => {
              setSpread(to)
              setAnim(null)
            }}
            onNext={() => go('next')}
            onPrev={() => go('prev')}
          />
        )}
        {doc && mode === 'scroll' && box.w > 0 && (
          <ScrollPages cache={cache.current!} count={count} width={scrollW} aspect={aspect} root={stageRef} onPage={setScrollPage} />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ página

function PageCanvas({ cache, index, width, height }: { cache: PageCache; index: number | null; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (index === null || !width) return
    let alive = true
    setReady(false)
    void cache.get(index, width).then((bitmap) => {
      const canvas = ref.current
      if (!alive || !canvas) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [cache, index, width])
  if (index === null) return <div className={styles.blank} style={{ width, height }} />
  return (
    <div className={styles.page} data-ready={ready || undefined} style={{ width, height }}>
      <canvas ref={ref} style={{ width, height }} aria-label={`Página ${index + 1}`} />
    </div>
  )
}

// ------------------------------------------------------------ livro

interface BookProps {
  cache: PageCache
  count: number
  spread: number
  twoUp: boolean
  anim: Anim | null
  pageW: number
  pageH: number
  onFlipEnd(to: number): void
  onNext(): void
  onPrev(): void
}

function Book({ cache, count, spread, twoUp, anim, pageW, pageH, onFlipEnd, onNext, onPrev }: BookProps) {
  const from = spreadPages(anim?.from ?? spread, count, twoUp)
  const to = anim ? spreadPages(anim.to, count, twoUp) : from
  const page = (i: number | null) => <PageCanvas cache={cache} index={i} width={pageW} height={pageH} />

  // O que fica parado por baixo enquanto a folha gira.
  let left = from[0]
  let right = from[1]
  if (anim && twoUp) {
    if (anim.dir === 'next') right = to[1]
    else left = to[0]
  }
  const single = !twoUp
  const staticSingle = anim && single ? (anim.dir === 'next' ? to[0] : from[0]) : from[0]

  const flipStyle = useMemo(() => ({ width: pageW, height: pageH, animationDuration: `${FLIP_MS}ms` }), [pageW, pageH])

  return (
    <div className={styles.book} style={{ width: single ? pageW : pageW * 2, height: pageH }}>
      {single ? (
        <div className={styles.side} onClick={onNext} onContextMenu={(e) => (e.preventDefault(), onPrev())}>
          {page(staticSingle)}
        </div>
      ) : (
        <>
          <div className={`${styles.side} ${styles.left}`} onClick={onPrev} title={from[0] !== null ? 'Página anterior' : undefined}>
            {page(left)}
          </div>
          <div className={`${styles.side} ${styles.right}`} onClick={onNext} title={from[1] !== null ? 'Próxima página' : undefined}>
            {page(right)}
          </div>
          {(from[0] !== null || to[0] !== null) && <div className={styles.spine} aria-hidden="true" />}
        </>
      )}

      {/* Folha que vira: frente = página saindo, verso = página chegando. */}
      {anim && (
        <div
          key={`${anim.from}-${anim.to}`}
          className={styles.leaf}
          data-dir={anim.dir}
          data-single={single || undefined}
          style={{ ...flipStyle, left: single || anim.dir === 'next' ? (single ? 0 : pageW) : 0 }}
          onAnimationEnd={() => onFlipEnd(anim.to)}
        >
          <div className={styles.face}>{single ? (anim.dir === 'next' ? page(from[0]) : page(to[0])) : anim.dir === 'next' ? page(from[1]) : page(from[0])}</div>
          <div className={`${styles.face} ${styles.back}`}>{single ? <div className={styles.paperBack} /> : anim.dir === 'next' ? page(to[0]) : page(to[1])}</div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ rolagem

function ScrollPages({
  cache,
  count,
  width,
  aspect,
  root,
  onPage,
}: {
  cache: PageCache
  count: number
  width: number
  aspect: number
  root: React.RefObject<HTMLDivElement | null>
  onPage(p: number): void
}) {
  const [visible, setVisible] = useState<Set<number>>(new Set([0, 1]))
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset['page'])
            if (e.isIntersecting) next.add(p)
          }
          return next
        })
      },
      { root: el, rootMargin: '800px 0px' },
    )
    el.querySelectorAll('[data-page]').forEach((n) => io.observe(n))
    const onScroll = () => {
      const pages = [...el.querySelectorAll<HTMLElement>('[data-page]')]
      const top = el.getBoundingClientRect().top + 40
      const cur = pages.find((p) => p.getBoundingClientRect().bottom > top)
      if (cur) onPage(Number(cur.dataset['page']))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [root, count, onPage])

  const height = Math.round(width / aspect)
  return (
    <div className={styles.column}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} data-page={i} className={styles.scrollPage} style={{ width, height }}>
          {visible.has(i) ? <PageCanvas cache={cache} index={i} width={width} height={height} /> : <div className={styles.page} style={{ width, height }} />}
          <span className={styles.pageNumber}>{i + 1}</span>
        </div>
      ))}
    </div>
  )
}
