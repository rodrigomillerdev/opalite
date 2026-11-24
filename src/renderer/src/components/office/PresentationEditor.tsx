import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpToLine,
  Baseline,
  Bold,
  ChevronDown,
  Circle,
  Copy,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  MoveRight,
  PaintBucket,
  PanelRight,
  Play,
  Plus,
  Redo2,
  Shapes,
  Slash,
  Square,
  SquareDashed,
  Strikethrough,
  Trash2,
  Triangle,
  Type,
  Underline,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DEFAULT_FONT,
  FONTS,
  LAYOUTS,
  type LayoutId,
  type Para,
  type Presentation,
  type Run,
  SLIDE_H,
  SLIDE_W,
  type ShapeKind,
  type SlideEl,
  cloneSlide,
  fontCss,
  isDark,
  layoutSlide,
  uid,
} from '../../lib/office/presentation'
import { type MenuItem, openMenu } from '../ui/Menu'
import { ColorPickerButton } from './ColorPicker'
import { Divider, OfficeShell, ToolButton } from './OfficeShell'
import styles from './PresentationEditor.module.css'
import { SlideInspector } from './SlideInspector'
import { SlidePresenter } from './SlidePresenter'
import { ElementView, SlideView, boxStyle, htmlToParas, parasToHtml } from './slide-render'
import { useOfficeFile } from './useOfficeFile'

/*
 * Editor de apresentações (.pptx): miniaturas à esquerda, slide no centro e
 * painel "Formatar" à direita. Elementos são movidos, redimensionados e
 * girados com o mouse (Shift mantém a proporção / gira de 15 em 15°), caixas
 * de texto são editadas com duplo clique, e o modo apresentação abre em tela
 * cheia (F5 do início, Shift+F5 ou Ctrl+Enter do slide atual).
 *
 * O modelo é um objeto mutável: cada alteração muda o slide no lugar, chama
 * changed() (que redesenha o canvas e as miniaturas e agenda o salvamento) e,
 * antes, record() guarda uma cópia para desfazer.
 */

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const PANEL_KEY = 'opalite.slides.panel'
const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5, 3]

/** Cópia do modelo para desfazer (imagens compartilham os bytes). */
function snapshot(p: Presentation): Presentation {
  return {
    ...p,
    slides: p.slides.map((s) => ({ ...s, elements: s.elements.map((e) => (e.type === 'image' ? { ...e } : { ...e, paras: structuredClone(e.paras) })) })),
  }
}

/**
 * Tamanho e cor que um texto sem estilo herda (o do primeiro trecho). Negrito,
 * itálico, fonte etc. não são herdados: cada trecho do HTML já traz os seus, e
 * herdá-los espalharia o estilo de uma palavra para a linha inteira.
 */
function baseRun(el: SlideEl): Partial<Run> {
  if (el.type === 'image') return {}
  const r = el.paras[0]?.runs[0]
  return { ...(r?.size ? { size: r.size } : {}), ...(r?.color ? { color: r.color } : {}) }
}

/** rgb(…) do CSS para #rrggbb. */
function cssHex(c: string): string | undefined {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : undefined
}

const isLine = (el: SlideEl) => el.type === 'shape' && el.shape === 'line'

/** Miniatura de cada layout para o menu "Novo slide". */
function layoutIcon(id: LayoutId) {
  const parts: Record<LayoutId, React.ReactNode> = {
    title: (
      <>
        <rect x="3" y="6" width="10" height="2" rx="0.6" fill="currentColor" />
        <rect x="5" y="9.5" width="6" height="1.2" rx="0.6" fill="currentColor" opacity="0.6" />
      </>
    ),
    content: (
      <>
        <rect x="2.5" y="3" width="8" height="1.8" rx="0.6" fill="currentColor" />
        <path d="M3 7.5h9M3 10h7M3 12.5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </>
    ),
    twoColumns: (
      <>
        <rect x="2.5" y="3" width="8" height="1.8" rx="0.6" fill="currentColor" />
        <path d="M3 7.5h4M3 10h4M3 12.5h3M9 7.5h4M9 10h4M9 12.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </>
    ),
    titleOnly: <rect x="2.5" y="3" width="8" height="1.8" rx="0.6" fill="currentColor" />,
    section: (
      <>
        <rect x="2.5" y="7" width="9" height="2" rx="0.6" fill="currentColor" />
        <rect x="2.5" y="10.5" width="3" height="0.9" rx="0.45" fill="currentColor" opacity="0.6" />
      </>
    ),
    blank: null,
  }
  const Icon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="0.75" y="1.75" width="14.5" height="12.5" rx="1.6" stroke="currentColor" strokeWidth="1.1" />
      {parts[id]}
    </svg>
  )
  return Icon
}

const layoutMenu = (): MenuItem[] => [{ type: 'label', label: 'Layout do novo slide' }, ...LAYOUTS.map((l) => ({ id: l.id, label: l.label, icon: layoutIcon(l.id) }))]

export default function PresentationEditor({ path }: { path: string }) {
  const file = useOfficeFile<Presentation>({
    path,
    load: async (bytes) => (await import('../../lib/office/pptx')).readPptx(bytes),
    save: async (p) => (await import('../../lib/office/pptx')).writePptx(p),
  })
  const pres = file.model
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [, setVersion] = useState(0)
  const [scale, setScale] = useState(1)
  /** Cor do texto onde está o cursor/seleção, durante a edição. */
  const [selColor, setSelColor] = useState<string | undefined>()
  const [presenting, setPresenting] = useState<number | null>(null)
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== '0'
    } catch {
      return true
    }
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLDivElement>(null)
  const undo = useRef<Presentation[]>([])
  const redo = useRef<Presentation[]>([])
  const dragSlide = useRef<number | null>(null)
  /** Estado antes da edição de texto em curso (vira um único passo de desfazer). */
  const editSnap = useRef<{ snap: Presentation; before: string } | null>(null)
  /** Última seleção dentro da caixa em edição (a barra de ferramentas pode roubar o foco). */
  const savedRange = useRef<Range | null>(null)
  /** Caixa de texto que acabou de entrar em edição (preenchida no layout effect abaixo). */
  const pendingEdit = useRef<{ id: string; selectAll: boolean } | null>(null)
  /** Um arraste de controle deslizante ou de cor vira um único passo de desfazer. */
  const gesture = useRef(false)

  const cur = pres ? Math.max(0, Math.min(index, pres.slides.length - 1)) : 0
  const slide = pres?.slides[cur]

  // Escala do slide para caber na área central.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = () => setScale(Math.max(0.2, Math.min((el.clientWidth - 64) / SLIDE_W, (el.clientHeight - 64) / SLIDE_H)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [Boolean(pres)])

  // Ao abrir, o foco vai para o editor (os atalhos de teclado passam a valer).
  useEffect(() => {
    if (pres) rootRef.current?.focus({ preventScroll: true })
  }, [Boolean(pres)])

  // Fim de um arraste (controle deslizante, seletor de cor, teclas): o próximo ajuste é um novo passo de desfazer.
  useEffect(() => {
    const end = () => (gesture.current = false)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('keyup', end, true)
    return () => {
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('keyup', end, true)
    }
  }, [])

  // Guarda a seleção de texto da caixa em edição.
  useEffect(() => {
    if (!editing) return
    const onSel = () => {
      const sel = window.getSelection()
      const box = editRef.current
      if (box && sel?.rangeCount && box.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const range = sel.getRangeAt(0)
        savedRange.current = range.cloneRange()
        // Cor no início da seleção (para a faixa do botão de cor do texto).
        let node: Node | null = range.startContainer
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
        else if (node instanceof Element && node.childNodes[range.startOffset] instanceof Element) node = node.childNodes[range.startOffset]!
        if (node instanceof Element) setSelColor(cssHex(getComputedStyle(node).color))
      }
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [editing])

  const changed = useCallback(() => {
    setVersion((v) => v + 1)
    if (pres) file.change(pres)
  }, [pres, file])

  /** Guarda o estado para desfazer antes de uma alteração. */
  const record = useCallback(() => {
    if (!pres) return
    undo.current.push(snapshot(pres))
    if (undo.current.length > 100) undo.current.shift()
    redo.current = []
  }, [pres])

  /** record() uma vez por gesto contínuo. */
  const recordOnce = () => {
    if (gesture.current) return
    gesture.current = true
    record()
  }

  const focusEditor = () => rootRef.current?.focus({ preventScroll: true })

  const selectedEls = slide?.elements.filter((e) => selected.includes(e.id)) ?? []
  const first = selectedEls[0]
  const textEls = () => selectedEls.filter((e) => e.type !== 'image')

  // ------------------------------------------------------------ texto

  const editingEl = () => (editing ? slide?.elements.find((e) => e.id === editing) : undefined)

  /** Copia o texto da caixa em edição para o modelo (miniatura em tempo real). */
  const syncEditing = () => {
    const el = editingEl()
    const box = editRef.current
    if (!el || el.type === 'image' || !box) return
    el.paras = htmlToParas(box, baseRun(el))
    changed()
  }

  /** Fecha a edição de texto; vira um passo de desfazer se algo mudou. */
  const finishEditing = () => {
    const el = editingEl()
    if (el && el.type !== 'image' && editRef.current && !pendingEdit.current) {
      el.paras = htmlToParas(editRef.current, baseRun(el))
      const snap = editSnap.current
      if (snap && JSON.stringify(el.paras) !== snap.before) {
        undo.current.push(snap.snap)
        redo.current = []
      }
      changed()
    }
    editSnap.current = null
    savedRange.current = null
    pendingEdit.current = null
    setSelColor(undefined)
    setEditing(null)
  }

  const startEditing = (el: SlideEl, selectAll = false) => {
    if (el.type === 'image' || isLine(el) || !pres || editing === el.id) return
    if (editing) finishEditing()
    setSelected([el.id])
    setEditing(el.id)
    editSnap.current = { snap: snapshot(pres), before: JSON.stringify(el.paras) }
    pendingEdit.current = { id: el.id, selectAll }
  }

  // Preenche e foca a caixa de edição logo depois que ela aparece (antes da
  // pintura; não depende de requestAnimationFrame, que não roda com a janela
  // minimizada ou encoberta).
  useLayoutEffect(() => {
    const want = pendingEdit.current
    const box = editRef.current
    if (!want || !box || editing !== want.id) return
    pendingEdit.current = null
    const el = slide?.elements.find((e) => e.id === want.id)
    if (!el || el.type === 'image') return
    box.innerHTML = parasToHtml(el.paras)
    box.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(box)
    if (!want.selectAll) range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    savedRange.current = range.cloneRange()
  }, [editing])

  /** Devolve o foco e a seleção à caixa em edição; sem seleção, seleciona o texto todo. */
  const restoreSelection = () => {
    const box = editRef.current
    if (!box) return
    box.focus({ preventScroll: true })
    const sel = window.getSelection()
    let range = savedRange.current
    if (!range || range.collapsed) {
      range = document.createRange()
      range.selectNodeContents(box)
    }
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  /** Formatação de trecho: com texto em edição vale para a seleção; senão, para o elemento todo. */
  const formatRuns = (cmd: string, patch: (r: Run) => Partial<Run>, value?: string) => {
    if (editing && editRef.current) {
      restoreSelection()
      document.execCommand('styleWithCSS', false, 'true')
      document.execCommand(cmd, false, value)
      syncEditing()
      return
    }
    const els = textEls()
    if (!els.length) return
    recordOnce()
    for (const el of els) for (const p of el.paras) p.runs = p.runs.map((r) => ({ ...r, ...patch(r) }))
    changed()
  }

  /** Alteração de parágrafo ou de caixa inteira (alinhamento, listas, espaçamento, tamanho). */
  const formatParas = (mut: (p: Para, el: SlideEl) => void) => {
    const box = editRef.current
    const el = editingEl()
    if (el && el.type !== 'image' && box) {
      el.paras = htmlToParas(box, baseRun(el))
      for (const p of el.paras) mut(p, el)
      box.innerHTML = parasToHtml(el.paras)
      savedRange.current = null
      box.focus()
      const range = document.createRange()
      range.selectNodeContents(box)
      range.collapse(false)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      changed()
      return
    }
    const els = textEls()
    if (!els.length) return
    record()
    for (const e of els) for (const p of e.paras) mut(p, e)
    changed()
  }

  const setSize = (delta: number) => formatParas((p) => (p.runs = p.runs.map((r) => ({ ...r, size: Math.max(6, Math.min(200, (r.size ?? 18) + delta)) }))))

  const setFont = (name: string) => {
    const font = name === DEFAULT_FONT ? undefined : name
    if (editing && editRef.current) return formatRuns('fontName', () => ({}), fontCss(name))
    formatRuns('', () => ({ font }))
  }

  const toggleList = (kind: 'bullet' | 'numbered') => {
    const on = !(kind === 'bullet' ? para0?.bullet && !para0.numbered : para0?.numbered)
    formatParas((p) => {
      delete p.bullet
      delete p.numbered
      if (on) p[kind] = true
    })
  }

  /** Alterações de aparência vindas do painel (agrupadas por gesto no desfazer). */
  const editEls = (mut: (el: SlideEl) => void) => {
    if (!selectedEls.length) return
    if (editing) finishEditing()
    recordOnce()
    for (const el of selectedEls) mut(el)
    changed()
  }

  const setBackground = (color: string, all: boolean) => {
    if (!pres || !slide) return
    recordOnce()
    if (all) for (const s of pres.slides) s.background = color
    else slide.background = color
    changed()
  }

  // ------------------------------------------------------------ elementos

  const addElement = (el: SlideEl) => {
    if (!slide) return
    if (editing) finishEditing()
    // Cada novo elemento nasce um pouco deslocado se cair sobre outro igual.
    while (slide.elements.some((o) => Math.abs(o.x - el.x) < 8 && Math.abs(o.y - el.y) < 8)) {
      el.x += 24
      el.y += 24
    }
    record()
    slide.elements.push(el)
    setSelected([el.id])
    changed()
    if (el.type === 'text') startEditing(el, true)
    else focusEditor()
  }

  const addText = () =>
    addElement({ id: uid(), type: 'text', x: 280, y: 230, w: 400, h: 80, valign: 'top', paras: [{ runs: [{ text: 'Texto', size: 24, color: '#1f2430' }] }] })

  const addShape = (shape: ShapeKind) =>
    addElement({
      id: uid(),
      type: 'shape',
      shape,
      x: shape === 'line' ? 380 : 380,
      y: shape === 'line' ? 270 : 200,
      w: 200,
      h: shape === 'line' ? 0.01 : 140,
      fill: shape === 'line' ? undefined : '#7c6cf0',
      stroke: shape === 'line' ? '#1f2430' : undefined,
      strokeWidth: shape === 'line' ? 1.5 : undefined,
      paras: [{ align: 'center', runs: [{ text: '', size: 18, color: '#ffffff' }] }],
      valign: 'middle',
    })

  const addImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      const data = new Uint8Array(await f.arrayBuffer())
      const url = URL.createObjectURL(f)
      const img = new Image()
      img.onload = () => {
        const ratio = img.naturalHeight / Math.max(1, img.naturalWidth)
        let w = Math.min(560, img.naturalWidth)
        if (w * ratio > SLIDE_H - 40) w = (SLIDE_H - 40) / ratio
        URL.revokeObjectURL(url)
        addElement({ id: uid(), type: 'image', x: Math.round((SLIDE_W - w) / 2), y: Math.round(Math.max(20, (SLIDE_H - w * ratio) / 2)), w: Math.round(w), h: Math.round(w * ratio), data, mime: f.type || 'image/png' })
      }
      img.src = url
    }
    input.click()
  }

  const removeSelected = () => {
    if (!slide || !selected.length) return
    if (editing) finishEditing()
    record()
    slide.elements = slide.elements.filter((e) => !selected.includes(e.id))
    setSelected([])
    changed()
  }

  const duplicateSelected = () => {
    if (!slide || !selectedEls.length) return
    record()
    const copies = selectedEls.map((el) => ({ ...structuredClone(el), ...(el.type === 'image' ? { data: el.data } : {}), id: uid(), x: el.x + 16, y: el.y + 16 }) as SlideEl)
    slide.elements.push(...copies)
    setSelected(copies.map((c) => c.id))
    changed()
  }

  const reorder = (toFront: boolean) => {
    if (!slide || !selected.length) return
    record()
    const sel = slide.elements.filter((e) => selected.includes(e.id))
    const rest = slide.elements.filter((e) => !selected.includes(e.id))
    slide.elements = toFront ? [...rest, ...sel] : [...sel, ...rest]
    changed()
  }

  const fill = (color: string | null) => {
    const els = selectedEls.filter((e) => e.type !== 'image' && !isLine(e))
    if (!selected.length) return color && setBackground(color, false)
    if (!els.length) return
    record()
    for (const el of els)
      if (el.type !== 'image') {
        if (color) el.fill = color
        else delete el.fill
      }
    changed()
  }

  /** Cor do texto: na seleção (editando) ou em todo o texto dos elementos selecionados. */
  const setTextColor = (color: string) => {
    formatRuns('foreColor', () => ({ color }), color)
    if (editing) setSelColor(color)
  }

  /** Mover/redimensionar com o mouse (vários selecionados movem juntos). */
  const onElementPointerDown = (e: React.PointerEvent, el: SlideEl, handle?: Handle) => {
    if (e.button !== 0 || editing === el.id) return
    e.stopPropagation()
    if (editing) finishEditing()
    focusEditor()
    let ids = selected
    if (e.shiftKey && !handle) ids = selected.includes(el.id) ? selected.filter((i) => i !== el.id) : [...selected, el.id]
    else if (!selected.includes(el.id)) ids = [el.id]
    setSelected(ids)
    const targets = handle ? [el] : slide!.elements.filter((x) => ids.includes(x.id))
    const start = targets.map((t) => ({ t, x: t.x, y: t.y, w: t.w, h: t.h }))
    const sx = e.clientX
    const sy = e.clientY
    let moved = false
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale
      const dy = (ev.clientY - sy) / scale
      if (!moved && Math.hypot(dx, dy) < 2) return
      if (!moved) record()
      moved = true
      for (const s of start) {
        if (!handle) {
          // Ímã de 6 px nas bordas e no centro do slide (Alt desliga).
          let nx = s.x + dx
          let ny = s.y + dy
          if (!ev.altKey && start.length === 1) {
            const snap = (v: number, size: number, total: number) => {
              for (const target of [0, total / 2 - size / 2, total - size]) if (Math.abs(v - target) < 6) return target
              return v
            }
            nx = snap(nx, s.w, SLIDE_W)
            ny = snap(ny, s.h, SLIDE_H)
          }
          s.t.x = Math.round(nx)
          s.t.y = Math.round(ny)
        } else {
          // Redimensiona no sistema do próprio elemento (funciona girado):
          // o canto/lado oposto ao puxado fica parado.
          const rad = ((s.t.rot ?? 0) * Math.PI) / 180
          const cos = Math.cos(rad)
          const sin = Math.sin(rad)
          const lx = dx * cos + dy * sin
          const ly = -dx * sin + dy * cos
          const line = isLine(s.t)
          let L = 0
          let T = 0
          let R = s.w
          let B = s.h
          if (handle.includes('e')) R = s.w + lx
          if (handle.includes('w')) L = lx
          if (handle.includes('s')) B = s.h + ly
          if (handle.includes('n')) T = ly
          const keep = !line && (ev.shiftKey || s.t.type === 'image') && handle.length === 2 && s.w > 0 && s.h > 0
          if (keep) {
            const h = (R - L) * (s.h / s.w)
            if (handle.includes('n')) T = B - h
            else B = T + h
          }
          const minW = 10
          const minH = line ? 0.01 : 10
          if (R - L < minW) handle.includes('w') ? (L = R - minW) : (R = L + minW)
          if (B - T < minH) handle.includes('n') ? (T = B - minH) : (B = T + minH)
          const w = R - L
          const h = B - T
          const cx = (L + R) / 2 - s.w / 2
          const cy = (T + B) / 2 - s.h / 2
          const centerX = s.x + s.w / 2 + cx * cos - cy * sin
          const centerY = s.y + s.h / 2 + cx * sin + cy * cos
          s.t.w = Math.round(w)
          s.t.h = line ? Math.max(0.01, Math.round(h)) : Math.round(h)
          s.t.x = Math.round(centerX - w / 2)
          s.t.y = Math.round(centerY - h / 2)
        }
      }
      setVersion((v) => v + 1)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) changed()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Girar pela alça acima do elemento (Shift: de 15 em 15°; perto de 0/90/180 encaixa). */
  const onRotatePointerDown = (e: React.PointerEvent, el: SlideEl) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const frame = slideRef.current?.getBoundingClientRect()
    if (!frame) return
    const cx = frame.left + (el.x + el.w / 2) * scale
    const cy = frame.top + (el.y + el.h / 2) * scale
    let recorded = false
    const move = (ev: PointerEvent) => {
      if (!recorded) {
        record()
        recorded = true
      }
      let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      else {
        const near = Math.round(deg / 90) * 90
        if (Math.abs(deg - near) < 3) deg = near
      }
      deg = ((((Math.round(deg) + 180) % 360) + 360) % 360) - 180
      if (deg === 0) delete el.rot
      else el.rot = deg
      setVersion((v) => v + 1)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (recorded) changed()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ------------------------------------------------------------ slides

  const goToSlide = (i: number) => {
    if (editing) finishEditing()
    setIndex(i)
    setSelected([])
  }

  const addSlide = async (at: { x: number; y: number }) => {
    if (!pres) return
    const id = (await openMenu(layoutMenu(), at)) as LayoutId | null
    if (!id) return
    if (editing) finishEditing()
    record()
    pres.slides.splice(cur + 1, 0, layoutSlide(id, slide?.background ?? '#ffffff'))
    setIndex(cur + 1)
    setSelected([])
    changed()
    focusEditor()
  }

  const duplicateSlide = (i: number) => {
    if (!pres) return
    record()
    pres.slides.splice(i + 1, 0, cloneSlide(pres.slides[i]!))
    setIndex(i + 1)
    setSelected([])
    changed()
  }

  const deleteSlide = (i: number) => {
    if (!pres || pres.slides.length <= 1) return
    if (editing) finishEditing()
    record()
    pres.slides.splice(i, 1)
    const next = Math.max(0, Math.min(i, pres.slides.length - 1))
    setIndex(next)
    setSelected([])
    changed()
    // O foco continua nas miniaturas (Del de novo exclui o próximo, setas navegam).
    setTimeout(() => rootRef.current?.querySelector<HTMLElement>(`[aria-label="Slide ${next + 1}"]`)?.focus({ preventScroll: true }), 0)
  }

  const present = (from: number) => {
    if (!pres) return
    if (editing) finishEditing()
    setPresenting(Math.max(0, Math.min(from, pres.slides.length - 1)))
  }

  const slideMenu = async (i: number, e: React.MouseEvent) => {
    e.preventDefault()
    if (!pres) return
    goToSlide(i)
    const at = { x: e.clientX, y: e.clientY }
    const id = await openMenu(
      [
        { id: 'new', label: 'Novo slide', icon: Plus, submenu: LAYOUTS.map((l) => ({ id: `new:${l.id}`, label: l.label, icon: layoutIcon(l.id) })) },
        { id: 'dup', label: 'Duplicar slide', icon: Copy, shortcut: 'Ctrl+D' },
        { id: 'present', label: 'Apresentar a partir daqui', icon: Play, shortcut: 'Shift+F5' },
        { type: 'separator' },
        { id: 'del', label: 'Excluir slide', icon: Trash2, danger: true, disabled: pres.slides.length <= 1, shortcut: 'Del' },
      ],
      at,
    )
    if (id?.startsWith('new:')) {
      record()
      pres.slides.splice(i + 1, 0, layoutSlide(id.slice(4) as LayoutId, pres.slides[i]!.background))
      setIndex(i + 1)
      changed()
    } else if (id === 'new') void addSlide(at)
    else if (id === 'dup') duplicateSlide(i)
    else if (id === 'present') present(i)
    else if (id === 'del') deleteSlide(i)
  }

  const history = (from: React.MutableRefObject<Presentation[]>, to: React.MutableRefObject<Presentation[]>) => {
    if (editing) finishEditing()
    const prev = from.current.pop()
    if (!prev || !pres) return
    to.current.push(snapshot(pres))
    pres.slides = prev.slides
    // Mantém selecionado o que ainda existe (os ids não mudam ao desfazer).
    const ids = new Set(pres.slides[Math.min(cur, pres.slides.length - 1)]?.elements.map((e) => e.id))
    setSelected((sel) => sel.filter((id) => ids.has(id)))
    setEditing(null)
    setIndex((i) => Math.min(i, pres.slides.length - 1))
    changed()
  }

  // ------------------------------------------------------------ teclado

  /** Atalhos do editor (o foco fica no próprio editor; a caixa em edição trata o próprio teclado). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (presenting !== null || editing || !pres) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const inThumbs = Boolean(target.closest(`.${styles.thumbs}`))
    let handled = true
    if (e.key === 'F5') present(e.shiftKey ? cur : 0)
    else if (mod && e.key === 'Enter') present(cur)
    else if (mod && key === 'z' && !e.shiftKey) history(undo, redo)
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) history(redo, undo)
    else if (mod && key === 'd' && inThumbs) duplicateSlide(cur)
    else if (mod && key === 'd') duplicateSelected()
    else if (mod && key === 'a' && slide) setSelected(slide.elements.map((x) => x.id))
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      // O slide inteiro só é excluído com o foco nas miniaturas; no slide, Del apaga os elementos selecionados.
      if (inThumbs) deleteSlide(cur)
      else removeSelected()
    } else if (e.key.startsWith('Arrow') && selected.length && slide && !inThumbs) {
      const step = e.shiftKey ? 10 : 1
      if (!e.repeat || !gesture.current) recordOnce()
      for (const el of selectedEls) {
        if (e.key === 'ArrowLeft') el.x -= step
        if (e.key === 'ArrowRight') el.x += step
        if (e.key === 'ArrowUp') el.y -= step
        if (e.key === 'ArrowDown') el.y += step
      }
      changed()
    } else if (e.key === 'Escape') setSelected([])
    else if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === 'ArrowRight') goToSlide(Math.min(pres.slides.length - 1, cur + 1))
    else if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') goToSlide(Math.max(0, cur - 1))
    else if (e.key === 'Home') goToSlide(0)
    else if (e.key === 'End') goToSlide(pres.slides.length - 1)
    else if ((e.key === 'Enter' || e.key === 'F2') && first) startEditing(first, e.key === 'F2')
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // F5 com o foco fora do editor (logo depois de clicar na aba, por exemplo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting !== null || editing || !pres) return
      if (document.activeElement && document.activeElement !== document.body) return
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
        e.preventDefault()
        present(e.key === 'F5' && !e.shiftKey ? 0 : cur)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (file.error) return <div className={styles.error}>Não foi possível abrir a apresentação: {file.error}</div>

  const textFirst = first && first.type !== 'image' && !isLine(first) ? first : undefined
  const run0 = textFirst?.paras[0]?.runs[0]
  const para0 = textFirst?.paras[0]
  const noText = !textFirst
  /** Cor "automática": escura em fundo claro e clara em fundo escuro. */
  const autoText = slide && isDark(slide.background) ? '#f2f1ee' : '#1f2430'
  const fontName = run0?.font ?? DEFAULT_FONT
  const valign = textFirst ? (textFirst.valign ?? (textFirst.type === 'shape' ? 'middle' : 'top')) : 'top'
  const VIcon = valign === 'middle' ? AlignVerticalJustifyCenter : valign === 'bottom' ? AlignVerticalJustifyEnd : AlignVerticalJustifyStart

  const menuAt = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: r.left, y: r.bottom + 6 }
  }

  return (
    <OfficeShell
      path={path}
      state={file.state}
      loading={!pres}
      toolbar={
        <>
          <ToolButton icon={Undo2} label="Desfazer (Ctrl+Z)" disabled={!undo.current.length && !editing} onClick={() => history(undo, redo)} />
          <ToolButton icon={Redo2} label="Refazer (Ctrl+Y)" disabled={!redo.current.length} onClick={() => history(redo, undo)} />
          <Divider />
          <ToolButton icon={Plus} label="Novo slide (escolher layout)" onClick={(e) => void addSlide(menuAt(e))} />
          <ToolButton icon={Type} label="Caixa de texto" onClick={addText} />
          <ToolButton
            icon={Shapes}
            label="Forma"
            onClick={async (e) => {
              const id = await openMenu(
                [
                  { id: 'rect', label: 'Retângulo', icon: Square },
                  { id: 'roundRect', label: 'Retângulo arredondado', icon: SquareDashed },
                  { id: 'ellipse', label: 'Elipse', icon: Circle },
                  { id: 'triangle', label: 'Triângulo', icon: Triangle },
                  { id: 'arrow', label: 'Seta', icon: MoveRight },
                  { id: 'line', label: 'Linha', icon: Slash },
                ] satisfies MenuItem[],
                menuAt(e),
              )
              if (id) addShape(id as ShapeKind)
            }}
          />
          <ToolButton icon={ImagePlus} label="Imagem" onClick={addImage} />
          <Divider />
          <select
            className={styles.fontSelect}
            value={fontName}
            disabled={noText}
            onChange={(e) => setFont(e.target.value)}
            title="Fonte"
            aria-label="Fonte"
            style={{ fontFamily: fontCss(fontName) }}
          >
            {!FONTS.some((f) => f.name === fontName) && <option value={fontName}>{fontName}</option>}
            {(['Sem serifa', 'Com serifa', 'Monoespaçada'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {FONTS.filter((f) => f.group === g).map((f) => (
                  <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className={styles.sizeBtn} onClick={() => setSize(-2)} title="Diminuir fonte" aria-label="Diminuir fonte" disabled={noText}>
            A−
          </button>
          <span className={styles.sizeLabel}>{run0?.size ?? '—'}</span>
          <button className={styles.sizeBtn} onClick={() => setSize(2)} title="Aumentar fonte" aria-label="Aumentar fonte" disabled={noText}>
            A+
          </button>
          <ToolButton icon={Bold} label="Negrito (Ctrl+B)" disabled={noText} on={Boolean(run0?.b)} onClick={() => formatRuns('bold', () => ({ b: !run0?.b || undefined }))} />
          <ToolButton icon={Italic} label="Itálico (Ctrl+I)" disabled={noText} on={Boolean(run0?.i)} onClick={() => formatRuns('italic', () => ({ i: !run0?.i || undefined }))} />
          <ToolButton icon={Underline} label="Sublinhado (Ctrl+U)" disabled={noText} on={Boolean(run0?.u)} onClick={() => formatRuns('underline', () => ({ u: !run0?.u || undefined }))} />
          <ToolButton icon={Strikethrough} label="Tachado" disabled={noText} on={Boolean(run0?.s)} onClick={() => formatRuns('strikeThrough', () => ({ s: !run0?.s || undefined }))} />
          <ColorPickerButton
            icon={Baseline}
            label="Cor do texto"
            value={editing ? (selColor ?? run0?.color) : run0?.color}
            fallback={autoText}
            disabled={noText}
            automatic={{ label: 'Automática', color: autoText }}
            onPick={(c) => setTextColor(c ?? autoText)}
          />
          <Divider />
          <ToolButton icon={AlignLeft} label="Alinhar à esquerda" disabled={noText} on={Boolean(para0) && !para0?.align} onClick={() => formatParas((p) => delete p.align)} />
          <ToolButton icon={AlignCenter} label="Centralizar" disabled={noText} on={para0?.align === 'center'} onClick={() => formatParas((p) => (p.align = 'center'))} />
          <ToolButton icon={AlignRight} label="Alinhar à direita" disabled={noText} on={para0?.align === 'right'} onClick={() => formatParas((p) => (p.align = 'right'))} />
          <ToolButton
            icon={VIcon}
            label="Alinhamento vertical"
            disabled={noText}
            onClick={async (e) => {
              const id = await openMenu(
                [
                  { id: 'top', label: 'Topo', icon: AlignVerticalJustifyStart, checked: valign === 'top' },
                  { id: 'middle', label: 'Meio', icon: AlignVerticalJustifyCenter, checked: valign === 'middle' },
                  { id: 'bottom', label: 'Base', icon: AlignVerticalJustifyEnd, checked: valign === 'bottom' },
                ],
                menuAt(e),
              )
              if (!id) return
              record()
              for (const el of textEls()) el.valign = id as 'top' | 'middle' | 'bottom'
              changed()
            }}
          />
          <ToolButton
            icon={ArrowDownUp}
            label="Espaçamento"
            disabled={noText}
            onClick={async (e) => {
              const lh = para0?.lineHeight ?? 1
              const sp = run0?.spacing ?? 0
              const id = await openMenu(
                [
                  { type: 'label', label: 'Entre linhas' },
                  ...LINE_HEIGHTS.map((v) => ({ id: `lh:${v}`, label: v === 1 ? '1,0 (simples)' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1 }), checked: Math.abs(lh - v) < 0.01 })),
                  { type: 'separator' },
                  { type: 'label', label: 'Entre letras' },
                  ...(
                    [
                      [-1, 'Apertado'],
                      [0, 'Normal'],
                      [2, 'Amplo'],
                      [5, 'Muito amplo'],
                    ] as const
                  ).map(([v, label]) => ({ id: `sp:${v}`, label, checked: Math.abs(sp - v) < 0.01 })),
                ],
                menuAt(e),
              )
              if (id?.startsWith('lh:')) {
                const v = Number(id.slice(3))
                formatParas((p) => (v === 1 ? delete p.lineHeight : (p.lineHeight = v)))
              } else if (id?.startsWith('sp:')) {
                const v = Number(id.slice(3))
                formatParas((p) => (p.runs = p.runs.map((r) => ({ ...r, spacing: v || undefined }))))
              }
            }}
          />
          <ToolButton icon={List} label="Marcadores" disabled={noText} on={Boolean(para0?.bullet && !para0.numbered)} onClick={() => toggleList('bullet')} />
          <ToolButton icon={ListOrdered} label="Numeração" disabled={noText} on={Boolean(para0?.numbered)} onClick={() => toggleList('numbered')} />
          <Divider />
          <ColorPickerButton
            icon={PaintBucket}
            label={selected.length ? 'Preenchimento' : 'Fundo do slide'}
            value={selected.length ? (first && first.type !== 'image' ? first.fill : undefined) : slide?.background}
            fallback={selected.length ? 'transparent' : '#ffffff'}
            disabled={Boolean(selected.length) && !selectedEls.some((e) => e.type !== 'image' && !isLine(e))}
            automatic={selected.length ? { label: 'Sem preenchimento', color: null } : undefined}
            onPick={(c) => fill(c)}
          />
          <ToolButton icon={ArrowUpToLine} label="Trazer para a frente" disabled={!selected.length} onClick={() => reorder(true)} />
          <ToolButton icon={ArrowDownToLine} label="Enviar para trás" disabled={!selected.length} onClick={() => reorder(false)} />
          <ToolButton icon={Trash2} label="Excluir (Del)" disabled={!selected.length} onClick={removeSelected} />
          <Divider />
          <ToolButton
            icon={PanelRight}
            label="Painel Formatar"
            on={panel}
            onClick={() => {
              setPanel((v) => {
                try {
                  localStorage.setItem(PANEL_KEY, v ? '0' : '1')
                } catch {
                  // preferência só desta sessão
                }
                return !v
              })
            }}
          />
          <span className={styles.presentGroup}>
            <button className={styles.present} onClick={() => present(cur)} title="Apresentar deste slide (Shift+F5 ou Ctrl+Enter)">
              <Play size={14} fill="currentColor" /> Apresentar
            </button>
            <button
              className={styles.presentCaret}
              title="Opções de apresentação"
              aria-label="Opções de apresentação"
              onClick={async (e) => {
                const id = await openMenu(
                  [
                    { id: 'start', label: 'Do início', icon: Play, shortcut: 'F5' },
                    { id: 'here', label: 'Deste slide', icon: Play, shortcut: 'Shift+F5' },
                  ],
                  menuAt(e),
                )
                if (id === 'start') present(0)
                else if (id === 'here') present(cur)
              }}
            >
              <ChevronDown size={13} />
            </button>
          </span>
        </>
      }
      status={
        <>
          <span>
            Slide {cur + 1} de {pres?.slides.length ?? 0}
          </span>
          <span className={styles.hint}>Duplo clique edita o texto · Shift mantém a proporção · Ctrl+D duplica · F5 apresenta</span>
        </>
      }
    >
      <div ref={rootRef} className={styles.root} data-panel={panel || undefined} tabIndex={-1} onKeyDown={onKeyDown}>
        <aside className={styles.thumbs} aria-label="Slides">
          {pres?.slides.map((s, i) => (
            <div
              key={s.id}
              className={styles.thumbRow}
              draggable
              onDragStart={() => (dragSlide.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const from = dragSlide.current
                dragSlide.current = null
                if (from === null || from === i || !pres) return
                record()
                const [moved] = pres.slides.splice(from, 1)
                pres.slides.splice(i, 0, moved!)
                setIndex(i)
                changed()
              }}
            >
              <span className={styles.thumbNum}>{i + 1}</span>
              <button className={styles.thumb} data-on={i === cur || undefined} onClick={() => goToSlide(i)} onDoubleClick={() => present(i)} onContextMenu={(e) => void slideMenu(i, e)} aria-label={`Slide ${i + 1}`}>
                <SlideView slide={s} scale={168 / SLIDE_W} />
              </button>
            </div>
          ))}
          <button className={styles.addSlide} onClick={(e) => void addSlide({ x: e.clientX, y: e.clientY })}>
            <Plus size={14} /> Novo slide
          </button>
        </aside>

        <div
          ref={stageRef}
          className={styles.stage}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              if (editing) finishEditing()
              setSelected([])
              focusEditor()
            }
          }}
        >
          {slide && (
            <div className={styles.slideFrame} style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
              <div
                ref={slideRef}
                className={styles.slide}
                style={{ background: slide.background, transform: `scale(${scale})` }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    if (editing) finishEditing()
                    setSelected([])
                    focusEditor()
                  }
                }}
              >
                {slide.elements.map((el) => {
                  const isSel = selected.includes(el.id)
                  const isEditing = editing === el.id
                  return (
                    <div
                      key={el.id}
                      className={styles.el}
                      data-selected={isSel || undefined}
                      data-editing={isEditing || undefined}
                      data-line={isLine(el) || undefined}
                      style={boxStyle(el)}
                      onPointerDown={(e) => onElementPointerDown(e, el)}
                      onDoubleClick={() => startEditing(el)}
                    >
                      <ElementView el={el} editing={isEditing} />
                      {isEditing && el.type !== 'image' && (
                        <div
                          ref={editRef}
                          className={styles.text}
                          data-valign={el.valign ?? (el.type === 'shape' ? 'middle' : 'top')}
                          contentEditable
                          suppressContentEditableWarning
                          spellCheck
                          lang="pt-BR"
                          onInput={syncEditing}
                          onBlur={(e) => {
                            // Clique na barra de ferramentas ou no painel não encerra a edição.
                            const to = e.relatedTarget as HTMLElement | null
                            if (to?.closest(`[role=toolbar], .${styles.inspector}, [data-keep-editing]`)) return
                            finishEditing()
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Escape') {
                              finishEditing()
                              focusEditor()
                            }
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                      )}
                      {isSel && !isEditing && selected.length === 1 && (
                        <>
                          {HANDLES.filter((h) => !isLine(el) || h === 'e' || h === 'w').map((h) => (
                            <span key={h} className={styles.handle} data-h={h} style={{ transform: `scale(${1 / scale})` }} onPointerDown={(e) => onElementPointerDown(e, el, h)} />
                          ))}
                          {!isLine(el) && (
                            <span className={styles.rotHandle} style={{ transform: `translateX(-50%) scale(${1 / scale})` }} onPointerDown={(e) => onRotatePointerDown(e, el)} title="Girar (Shift: de 15 em 15°)" />
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {panel && slide && <SlideInspector slide={slide} selected={selectedEls} onEdit={editEls} onBackground={setBackground} onTextColor={(c) => editEls((el) => el.type !== 'image' && el.paras.forEach((p) => (p.runs = p.runs.map((r) => ({ ...r, color: c })))))} />}
      </div>

      {presenting !== null && pres && (
        <SlidePresenter
          slides={pres.slides}
          start={presenting}
          onExit={(i) => {
            setPresenting(null)
            setIndex(i)
            setSelected([])
            setTimeout(focusEditor, 0)
          }}
        />
      )}
    </OfficeShell>
  )
}
