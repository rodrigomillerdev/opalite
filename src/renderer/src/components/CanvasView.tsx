import {
  FileText,
  Frame,
  HelpCircle,
  Link as LinkIcon,
  Maximize,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CANVAS_COLORS,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Side,
  anchor,
  bestSides,
  colorCss,
  edgePath,
  nearestSide,
  newId,
  nodesInside,
  parseCanvas,
  serializeCanvas,
} from '../lib/canvas'
import { blobUrl, extOf, fileName, kindOf } from '../lib/attachments'
import { registerFlusher } from '../lib/flushers'
import { fuzzyFilter } from '../lib/fuzzy'
import { renderMiniMarkdown } from '../lib/mini-markdown'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import styles from './CanvasView.module.css'
import { Highlight, Prompt } from './Prompt'

/*
 * Canvas: um quadro infinito com cartões ligados por setas, salvo como
 * .canvas (JSON Canvas). O "mundo" é uma camada transformada por
 * translate+scale; cartões são <div>s e as conexões, um <svg> no mesmo mundo.
 */

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const MIN_W = 80
const MIN_H = 40

interface View {
  x: number
  y: number
  k: number
}

type Selection = Set<string>

/** Omit que funciona em cada tipo da união (text, file, link, group). */
type NewNode = CanvasNode extends unknown ? (CanvasNode extends infer T ? (T extends CanvasNode ? Omit<T, 'id'> & { id?: string } : never) : never) : never

export default function CanvasView({ path }: { path: string }) {
  const [data, setData] = useState<CanvasData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [selected, setSelected] = useState<Selection>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<{ from: string; side: Side; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null)
  const [help, setHelp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const history = useRef<{ past: CanvasData[]; future: CanvasData[] }>({ past: [], future: [] })
  const lastSaved = useRef<string>('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dataRef = useRef<CanvasData | null>(null)
  dataRef.current = data
  const viewRef = useRef(view)
  viewRef.current = view

  // ------------------------------------------------------------ arquivo

  const load = useCallback(async () => {
    try {
      const file = await window.opalite.files.read(path)
      lastSaved.current = file.content
      const parsed = parseCanvas(file.content)
      setData(parsed)
      setError(null)
      return parsed
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }, [path])

  useEffect(() => {
    void load().then((parsed) => {
      if (parsed?.nodes.length) requestAnimationFrame(() => fitTo(parsed))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const current = dataRef.current
    if (!current) return
    const text = serializeCanvas(current)
    if (text === lastSaved.current) return
    lastSaved.current = text
    try {
      await window.opalite.files.write(path, text)
    } catch (err) {
      useVault.setState({ error: `Não foi possível salvar o canvas: ${(err as Error).message}` })
    }
  }, [path])

  // Salva ao sair do canvas (troca de aba, fechar o app).
  useEffect(() => {
    const off = registerFlusher(flush)
    return () => {
      off()
      void flush()
    }
  }, [flush])

  // Mudança feita fora do app: recarrega se não há alteração pendente aqui.
  useEffect(
    () =>
      window.opalite.vault.onEvents((events) => {
        if (!events.some((e) => e.path === path && (e.type === 'change' || e.type === 'add'))) return
        if (saveTimer.current) return
        void window.opalite.files.read(path).then((file) => {
          if (file.content !== lastSaved.current) {
            lastSaved.current = file.content
            try {
              setData(parseCanvas(file.content))
            } catch {
              // arquivo em edição externa, ainda inválido
            }
          }
        })
      }),
    [path],
  )

  /** Aplica uma alteração: guarda o estado anterior (desfazer) e agenda o salvamento. */
  const commit = useCallback((update: (d: CanvasData) => CanvasData, record = true) => {
    setData((prev) => {
      if (!prev) return prev
      const next = update(prev)
      if (next === prev) return prev
      if (record) {
        history.current.past.push(prev)
        if (history.current.past.length > 100) history.current.past.shift()
        history.current.future = []
      }
      return next
    })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), 500)
  }, [flush])

  // Arquivos soltos sobre o canvas (já copiados para o cofre pela DropLayer).
  useEffect(() => {
    const onDrop = (e: Event) => {
      const { paths, x, y } = (e as CustomEvent<{ paths: string[]; x: number; y: number }>).detail
      const at = toWorld(x, y)
      const nodes: CanvasNode[] = paths.map((file, i) => {
        const image = kindOf(file) === 'image'
        const md = kindOf(file) === 'md'
        return {
          id: newId(),
          type: 'file',
          file,
          x: Math.round(at.x - 160 + i * 30),
          y: Math.round(at.y - 100 + i * 30),
          width: image ? 320 : md ? 400 : 300,
          height: image ? 220 : md ? 300 : 84,
        }
      })
      commit((d) => ({ ...d, nodes: [...d.nodes, ...nodes] }))
      setSelected(new Set(nodes.map((n) => n.id)))
    }
    window.addEventListener('opalite:canvas-drop', onDrop)
    return () => window.removeEventListener('opalite:canvas-drop', onDrop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit])

  const undo = () => {
    const prev = history.current.past.pop()
    if (!prev || !data) return
    history.current.future.push(data)
    commit(() => prev, false)
  }
  const redo = () => {
    const next = history.current.future.pop()
    if (!next || !data) return
    history.current.past.push(data)
    commit(() => next, false)
  }

  // ------------------------------------------------------------ visão

  const toWorld = (clientX: number, clientY: number) => {
    const rect = rootRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k }
  }

  const viewCenter = () => {
    const rect = rootRef.current!.getBoundingClientRect()
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function fitTo(d: CanvasData | null = dataRef.current) {
    const root = rootRef.current
    if (!root || !d || d.nodes.length === 0) {
      setView({ x: (root?.clientWidth ?? 0) / 2, y: (root?.clientHeight ?? 0) / 2, k: 1 })
      return
    }
    const minX = Math.min(...d.nodes.map((n) => n.x))
    const minY = Math.min(...d.nodes.map((n) => n.y))
    const maxX = Math.max(...d.nodes.map((n) => n.x + n.width))
    const maxY = Math.max(...d.nodes.map((n) => n.y + n.height))
    // Desconta a coluna de controles (direita) e a barra de ferramentas (embaixo),
    // para nenhum cartão nascer escondido atrás deles.
    const w = Math.max(200, root.clientWidth - 72)
    const h = Math.max(200, root.clientHeight - 96)
    const k = Math.min(1.5, Math.max(0.1, Math.min(w / (maxX - minX + 120), h / (maxY - minY + 120))))
    setView({ k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k })
  }

  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    const rect = rootRef.current!.getBoundingClientRect()
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top
    setView((v) => {
      const k = Math.min(4, Math.max(0.1, v.k * factor))
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
    })
  }

  // Wheel precisa de listener não passivo para impedir a rolagem da página.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input, [data-scrollable]') && !e.ctrlKey) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data !== null])

  // ------------------------------------------------------------ criação

  const addNode = (node: NewNode, edit = false) => {
    const full = { ...node, id: node.id ?? newId() } as CanvasNode
    commit((d) => ({ ...d, nodes: node.type === 'group' ? [full, ...d.nodes] : [...d.nodes, full] }))
    setSelected(new Set([full.id]))
    if (edit) setEditing(full.id)
    return full
  }

  const addText = (at = viewCenter(), edit = true) =>
    addNode({ type: 'text', text: '', x: Math.round(at.x - 125), y: Math.round(at.y - 30), width: 250, height: 60 }, edit)

  const addLink = () => {
    const c = viewCenter()
    addNode({ type: 'link', url: '', x: Math.round(c.x - 200), y: Math.round(c.y - 40), width: 400, height: 80 }, true)
  }

  const addGroup = () => {
    const chosen = data?.nodes.filter((n) => selected.has(n.id)) ?? []
    if (chosen.length) {
      const pad = 30
      const x = Math.min(...chosen.map((n) => n.x)) - pad
      const y = Math.min(...chosen.map((n) => n.y)) - pad - 20
      const w = Math.max(...chosen.map((n) => n.x + n.width)) - x + pad
      const h = Math.max(...chosen.map((n) => n.y + n.height)) - y + pad
      addNode({ type: 'group', label: 'Grupo', x, y, width: w, height: h })
    } else {
      const c = viewCenter()
      addNode({ type: 'group', label: 'Grupo', x: Math.round(c.x - 250), y: Math.round(c.y - 150), width: 500, height: 300 })
    }
  }

  const addFile = (file: string) => {
    const at = picker ?? viewCenter()
    setPicker(null)
    addNode({ type: 'file', file, x: Math.round(at.x - 200), y: Math.round(at.y - 150), width: 400, height: 300 })
  }

  const removeSelected = () => {
    if (!selected.size) return
    commit((d) => ({
      nodes: d.nodes.filter((n) => !selected.has(n.id)),
      edges: d.edges.filter((e) => !selected.has(e.id) && !selected.has(e.fromNode) && !selected.has(e.toNode)),
    }))
    setSelected(new Set())
  }

  const setColor = (color: string | undefined) => {
    commit((d) => ({
      nodes: d.nodes.map((n) => (selected.has(n.id) ? withColor(n, color) : n)),
      edges: d.edges.map((e) => (selected.has(e.id) ? withColor(e, color) : e)),
    }))
  }

  // ------------------------------------------------------------ ponteiro

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    if ((e.target as HTMLElement).closest('[data-node], [data-edge], [data-ui]')) return
    rootRef.current?.focus()
    setEditing(null)
    if (!e.shiftKey) setSelected(new Set())
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }))
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const onNodePointerDown = (e: React.PointerEvent, node: CanvasNode) => {
    if (e.button !== 0 || editing === node.id) return
    if ((e.target as HTMLElement).closest('[data-handle], [data-resize], a')) return
    e.stopPropagation()
    rootRef.current?.focus()
    const nextSel = new Set(selected)
    if (e.shiftKey) {
      if (nextSel.has(node.id)) nextSel.delete(node.id)
      else nextSel.add(node.id)
    } else if (!nextSel.has(node.id)) {
      nextSel.clear()
      nextSel.add(node.id)
    }
    setSelected(nextSel)
    if (!data) return

    // Move a seleção; grupos levam junto o que está dentro deles.
    const moving = new Set(nextSel)
    for (const n of data.nodes) if (moving.has(n.id) && n.type === 'group') for (const inner of nodesInside(n, data.nodes)) moving.add(inner.id)
    const origin = new Map(data.nodes.filter((n) => moving.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]))
    const start = toWorld(e.clientX, e.clientY)
    let moved = false
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY)
      const dx = Math.round(p.x - start.x)
      const dy = Math.round(p.y - start.y)
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return
      commit((d) => ({ ...d, nodes: d.nodes.map((n) => (origin.has(n.id) ? { ...n, x: origin.get(n.id)!.x + dx, y: origin.get(n.id)!.y + dy } : n)) }), !moved)
      moved = true
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const onResizePointerDown = (e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation()
    const start = toWorld(e.clientX, e.clientY)
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    let first = true
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY)
      const width = Math.max(MIN_W, Math.round(node.width + p.x - start.x))
      const height = Math.max(MIN_H, Math.round(node.height + p.y - start.y))
      commit((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? { ...n, width, height } : n)) }), first)
      first = false
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  /** Arrastar a partir de um ponto lateral cria uma conexão. */
  const onHandlePointerDown = (e: React.PointerEvent, node: CanvasNode, side: Side) => {
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const p0 = toWorld(e.clientX, e.clientY)
    setConnecting({ from: node.id, side, x: p0.x, y: p0.y })
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY)
      setConnecting({ from: node.id, side, x: p.x, y: p.y })
    }
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      setConnecting(null)
      const p = toWorld(ev.clientX, ev.clientY)
      const d = dataRef.current
      if (!d) return
      const hit = [...d.nodes].reverse().find((n) => n.id !== node.id && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height)
      if (hit) {
        const edge: CanvasEdge = { id: newId(), fromNode: node.id, fromSide: side, toNode: hit.id, toSide: nearestSide(hit, p.x, p.y) }
        commit((c) => ({ ...c, edges: [...c.edges, edge] }))
      } else if (Math.hypot(p.x - p0.x, p.y - p0.y) > 30) {
        // Soltar no vazio cria um cartão novo já conectado.
        const card: CanvasNode = { id: newId(), type: 'text', text: '', x: Math.round(p.x - 125), y: Math.round(p.y - 30), width: 250, height: 60 }
        const edge: CanvasEdge = { id: newId(), fromNode: node.id, fromSide: side, toNode: card.id, toSide: nearestSide(card, anchor(node, side).x, anchor(node, side).y) }
        commit((c) => ({ nodes: [...c.nodes, card], edges: [...c.edges, edge] }))
        setSelected(new Set([card.id]))
        setEditing(card.id)
      }
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || (e.target as HTMLElement).closest('input, textarea')) return
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeSelected()
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(data?.nodes.map((n) => n.id)))
    } else if (e.key === 'Escape') {
      setSelected(new Set())
    } else if (e.key === 'Enter' && selected.size === 1) {
      const node = data?.nodes.find((n) => selected.has(n.id))
      if (node && (node.type === 'text' || node.type === 'link' || node.type === 'group')) {
        e.preventDefault()
        setEditing(node.id)
      }
    }
  }

  // ------------------------------------------------------------ render

  const nodeById = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n]) ?? []), [data])

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button onClick={() => void load()}>Tentar de novo</button>
      </div>
    )
  }
  if (!data) return <div className={styles.root} />

  const selectedNode = selected.size === 1 ? data.nodes.find((n) => selected.has(n.id)) : undefined
  const selectedEdge = selected.size === 1 ? data.edges.find((e) => selected.has(e.id)) : undefined
  const gridSize = 24 * view.k

  return (
    <div
      ref={rootRef}
      className={styles.root}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-node], [data-edge], [data-ui]')) return
        addText(toWorld(e.clientX, e.clientY))
      }}
      style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      aria-label="Canvas"
    >
      <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className={styles.edges} aria-hidden="true">
          <defs>
            <marker id="opal-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {data.edges.map((edge) => {
            const a = nodeById.get(edge.fromNode)
            const b = nodeById.get(edge.toNode)
            if (!a || !b) return null
            const [autoFrom, autoTo] = bestSides(a, b)
            const fromSide = edge.fromSide ?? autoFrom
            const toSide = edge.toSide ?? autoTo
            const d = edgePath(anchor(a, fromSide), fromSide, anchor(b, toSide), toSide)
            const color = colorCss(edge.color) ?? 'var(--text-3)'
            const isSel = selected.has(edge.id)
            return (
              <g key={edge.id} data-edge>
                <path
                  d={d}
                  className={styles.edgeHit}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    rootRef.current?.focus()
                    setSelected(new Set([edge.id]))
                  }}
                />
                <path
                  d={d}
                  className={styles.edge}
                  data-selected={isSel || undefined}
                  style={{ stroke: isSel ? 'var(--accent)' : color }}
                  markerEnd={edge.toEnd === 'none' ? undefined : 'url(#opal-arrow)'}
                  markerStart={edge.fromEnd === 'arrow' ? 'url(#opal-arrow)' : undefined}
                />
              </g>
            )
          })}
          {connecting && nodeById.get(connecting.from) && (
            <path
              d={edgePath(anchor(nodeById.get(connecting.from)!, connecting.side), connecting.side, { x: connecting.x, y: connecting.y }, null)}
              className={styles.edge}
              style={{ stroke: 'var(--accent)' }}
              markerEnd="url(#opal-arrow)"
            />
          )}
        </svg>

        {data.nodes.map((node) => (
          <CardView
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
            editing={editing === node.id}
            zoom={view.k}
            onPointerDown={(e) => onNodePointerDown(e, node)}
            onResize={(e) => onResizePointerDown(e, node)}
            onHandle={(e, side) => onHandlePointerDown(e, node, side)}
            onStartEdit={() => {
              if (node.type === 'file') void useVault.getState().openFile(node.file, { newTab: true })
              else setEditing(node.id)
            }}
            onChange={(patch) => commit((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? ({ ...n, ...patch } as CanvasNode) : n)) }))}
            onAutoHeight={(height) => commit((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === node.id ? { ...n, height } : n)) }), false)}
            onStopEdit={() => {
              setEditing(null)
              rootRef.current?.focus()
            }}
          />
        ))}
      </div>

      {/* Barra do item selecionado: cores e excluir. */}
      {(selectedNode || selectedEdge) && !editing && (
        <div className={styles.selectionBar} data-ui onPointerDown={(e) => e.stopPropagation()}>
          <button className={styles.swatch} title="Sem cor" aria-label="Sem cor" onClick={() => setColor(undefined)} data-none />
          {CANVAS_COLORS.map((c) => (
            <button key={c.id} className={styles.swatch} style={{ background: c.css }} title={c.label} aria-label={c.label} onClick={() => setColor(c.id)} />
          ))}
          <span className={styles.sep} />
          {selectedNode?.type === 'file' && (
            <button className={styles.barButton} onClick={() => void useVault.getState().openFile(selectedNode.file, { newTab: true })} title="Abrir nota">
              <FileText size={14} strokeWidth={1.75} />
            </button>
          )}
          <button className={styles.barButton} onClick={removeSelected} title="Excluir (Delete)" aria-label="Excluir">
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}

      <div className={styles.controls} data-ui onPointerDown={(e) => e.stopPropagation()}>
        <div className={styles.controlGroup}>
          <button onClick={() => zoomBy(1.2)} title="Aproximar (Ctrl+rolagem)" aria-label="Aproximar">
            <Plus size={15} strokeWidth={1.75} />
          </button>
          <button onClick={() => setView((v) => ({ ...v, k: 1 }))} title="Zoom 100%" aria-label="Zoom 100%">
            <RotateCcw size={14} strokeWidth={1.75} />
          </button>
          <button onClick={() => fitTo()} title="Enquadrar tudo" aria-label="Enquadrar tudo">
            <Maximize size={14} strokeWidth={1.75} />
          </button>
          <button onClick={() => zoomBy(1 / 1.2)} title="Afastar" aria-label="Afastar">
            <Minus size={15} strokeWidth={1.75} />
          </button>
        </div>
        <div className={styles.controlGroup}>
          <button onClick={undo} disabled={!history.current.past.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
            <Undo2 size={14} strokeWidth={1.75} />
          </button>
          <button onClick={redo} disabled={!history.current.future.length} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
            <Redo2 size={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className={styles.controlGroup}>
          <button onClick={() => setHelp((v) => !v)} title="Ajuda" aria-label="Ajuda" aria-pressed={help}>
            <HelpCircle size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {help && (
        <div className={styles.help} data-ui onPointerDown={(e) => e.stopPropagation()}>
          <strong>Canvas</strong>
          <ul>
            <li>Clique duas vezes no fundo para criar um cartão</li>
            <li>Arraste o fundo ou role para mover; Ctrl + rolagem para zoom</li>
            <li>Arraste os pontos laterais de um cartão para conectar</li>
            <li>Clique duas vezes num cartão para editar; numa nota, para abrir</li>
            <li>Shift + clique seleciona vários; Delete exclui</li>
            <li>Ctrl+Z desfaz, Ctrl+Shift+Z refaz, Ctrl+A seleciona tudo</li>
          </ul>
        </div>
      )}

      {data.nodes.length === 0 && (
        <div className={styles.emptyHint}>
          <p>Clique duas vezes para criar um cartão</p>
          <p>Arraste o fundo para mover · Ctrl + rolagem para ampliar</p>
        </div>
      )}

      <div className={styles.toolbar} data-ui onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => addText()} title="Adicionar cartão de texto" aria-label="Adicionar cartão de texto">
          <StickyNote size={17} strokeWidth={1.6} />
        </button>
        <button onClick={() => setPicker(viewCenter())} title="Adicionar nota do cofre" aria-label="Adicionar nota do cofre">
          <FileText size={17} strokeWidth={1.6} />
        </button>
        <button onClick={addLink} title="Adicionar link da web" aria-label="Adicionar link da web">
          <LinkIcon size={17} strokeWidth={1.6} />
        </button>
        <button onClick={addGroup} title="Agrupar (em volta da seleção)" aria-label="Agrupar">
          <Frame size={17} strokeWidth={1.6} />
        </button>
      </div>

      {picker && <NotePicker onPick={addFile} onClose={() => setPicker(null)} />}
    </div>
  )
}

function withColor<T extends { color?: string }>(item: T, color: string | undefined): T {
  const { color: _old, ...rest } = item
  return (color ? { ...rest, color } : rest) as T
}

// ------------------------------------------------------------ cartões

interface CardProps {
  node: CanvasNode
  selected: boolean
  editing: boolean
  zoom: number
  onPointerDown(e: React.PointerEvent): void
  onResize(e: React.PointerEvent): void
  onHandle(e: React.PointerEvent, side: Side): void
  onStartEdit(): void
  onChange(patch: Partial<CanvasNode>): void
  /** Ajusta a altura para caber o conteúdo (sem entrar no histórico de desfazer). */
  onAutoHeight(height: number): void
  onStopEdit(): void
}

function CardView({ node, selected, editing, onPointerDown, onResize, onHandle, onStartEdit, onChange, onAutoHeight, onStopEdit }: CardProps) {
  const color = colorCss(node.color)
  return (
    <div
      data-node
      className={styles.card}
      data-type={node.type}
      data-selected={selected || undefined}
      data-colored={color ? true : undefined}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, ['--card-color' as string]: color ?? undefined }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) onStartEdit()
      }}
    >
      {node.type === 'group' ? (
        <GroupLabel node={node} editing={editing} onChange={onChange} onStopEdit={onStopEdit} />
      ) : (
        <div className={styles.cardBody} data-scrollable={!editing || undefined}>
          {node.type === 'text' && <TextCard node={node} editing={editing} onChange={onChange} onAutoHeight={onAutoHeight} onStopEdit={onStopEdit} />}
          {node.type === 'file' && <FileCard file={node.file} />}
          {node.type === 'link' && <LinkCard url={node.url} editing={editing} onChange={onChange} onStopEdit={onStopEdit} />}
        </div>
      )}
      {node.type !== 'group' &&
        SIDES.map((side) => <span key={side} data-handle className={styles.handle} data-side={side} onPointerDown={(e) => onHandle(e, side)} />)}
      {selected && <span data-resize className={styles.resize} onPointerDown={onResize} />}
    </div>
  )
}

function useLinkClicks() {
  return (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    if (a.dataset['link']) void useVault.getState().openLink(a.dataset['link'], null, { newTab: true })
    else if (a.dataset['url']) window.open(a.dataset['url'], '_blank')
  }
}

function TextCard({
  node,
  editing,
  onChange,
  onAutoHeight,
  onStopEdit,
}: {
  node: Extract<CanvasNode, { type: 'text' }>
  editing: boolean
  onChange(p: Partial<CanvasNode>): void
  onAutoHeight(height: number): void
  onStopEdit(): void
}) {
  const onClick = useLinkClicks()
  const html = useMemo(() => renderMiniMarkdown(node.text), [node.text])
  const viewRef = useRef<HTMLDivElement>(null)

  // Depois de renderizar o Markdown, se o conteúdo não couber, o cartão cresce.
  useLayoutEffect(() => {
    const body = viewRef.current?.parentElement
    if (editing || !body) return
    const overflow = body.scrollHeight - body.clientHeight
    if (overflow > 1) onAutoHeight(node.height + overflow)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, editing])
  if (editing) {
    return (
      <textarea
        className={styles.textarea}
        autoFocus
        defaultValue={node.text}
        placeholder="Escreva em Markdown…"
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onBlur={(e) => {
          const el = e.currentTarget
          // O cartão cresce para caber o texto (nunca encolhe sozinho).
          el.style.height = 'auto'
          const needed = Math.ceil(el.scrollHeight + 22)
          const patch: Partial<CanvasNode> = {}
          if (el.value !== node.text) Object.assign(patch, { text: el.value })
          if (needed > node.height) patch.height = needed
          if (Object.keys(patch).length) onChange(patch)
          onStopEdit()
        }}
        onInput={(e) => {
          const el = e.currentTarget
          const card = el.closest<HTMLElement>('[data-node]')
          if (card && el.scrollHeight + 22 > card.clientHeight) card.style.height = `${el.scrollHeight + 22}px`
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  }
  if (!node.text.trim()) return <p className={styles.placeholder}>Clique duas vezes para escrever</p>
  return <div ref={viewRef} className={styles.markdown} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

function FileCard({ file }: { file: string }) {
  const kind = kindOf(file)
  if (kind === 'image') return <ImageCard file={file} />
  if (kind !== 'md' && kind !== 'canvas') return <AttachmentCard file={file} />
  return <NoteFileCard file={file} />
}

function ImageCard({ file }: { file: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void blobUrl(file).then((u) => alive && setUrl(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [file])
  return url ? <img className={styles.cardImage} src={url} alt={fileName(file)} draggable={false} /> : <p className={styles.placeholder}>{fileName(file)}</p>
}

function AttachmentCard({ file }: { file: string }) {
  return (
    <div className={styles.attachment}>
      <span className={styles.attachmentBadge}>{extOf(file).toUpperCase()}</span>
      <div>
        <strong>{fileName(file)}</strong>
        <span>Clique duas vezes para abrir</span>
      </div>
    </div>
  )
}

function NoteFileCard({ file }: { file: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const version = useIndex((s) => s.version)
  const onClick = useLinkClicks()
  useEffect(() => {
    let cancelled = false
    window.opalite.files
      .read(file)
      .then((f) => {
        if (cancelled) return
        setMissing(false)
        // Sem frontmatter; só o começo da nota para a prévia ficar leve.
        setContent(f.content.replace(/^---\n[\s\S]*?\n---\n?/, '').slice(0, 3000))
      })
      .catch(() => !cancelled && setMissing(true))
    return () => {
      cancelled = true
    }
  }, [file, version])
  const title = file.slice(file.lastIndexOf('/') + 1).replace(/\.(md|canvas)$/i, '')
  const html = useMemo(() => (content === null ? '' : renderMiniMarkdown(content)), [content])
  return (
    <>
      <div className={styles.fileTitle}>
        <FileText size={13} strokeWidth={1.75} />
        <span>{title}</span>
      </div>
      {missing ? <p className={styles.placeholder}>Arquivo não encontrado: {file}</p> : <div className={styles.markdown} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />}
    </>
  )
}

function LinkCard({ url, editing, onChange, onStopEdit }: { url: string; editing: boolean; onChange(p: Partial<CanvasNode>): void; onStopEdit(): void }) {
  if (editing || !url) {
    return (
      <input
        className={styles.urlInput}
        autoFocus
        defaultValue={url}
        placeholder="https://…"
        spellCheck={false}
        onBlur={(e) => {
          const value = e.currentTarget.value.trim()
          if (value !== url) onChange({ url: value && !/^https?:\/\//i.test(value) ? `https://${value}` : value })
          onStopEdit()
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  }
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // URL inválida: mostra como está
  }
  return (
    <div className={styles.link}>
      <LinkIcon size={14} strokeWidth={1.75} />
      <div>
        <a
          href={url}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            window.open(url, '_blank')
          }}
        >
          {host}
        </a>
        <span>{url}</span>
      </div>
    </div>
  )
}

function GroupLabel({ node, editing, onChange, onStopEdit }: { node: Extract<CanvasNode, { type: 'group' }>; editing: boolean; onChange(p: Partial<CanvasNode>): void; onStopEdit(): void }) {
  if (editing) {
    return (
      <input
        className={styles.groupInput}
        autoFocus
        defaultValue={node.label ?? ''}
        onBlur={(e) => {
          onChange({ label: e.currentTarget.value })
          onStopEdit()
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    )
  }
  return <div className={styles.groupLabel}>{node.label || 'Grupo'}</div>
}

function NotePicker({ onPick, onClose }: { onPick(path: string): void; onClose(): void }) {
  const notes = useIndex((s) => s.notes)
  const [query, setQuery] = useState('')
  const results = fuzzyFilter(notes, query, (n) => n.title, 60)
  return (
    <div data-ui onPointerDown={(e) => e.stopPropagation()}>
      <Prompt
        placeholder="Escolha uma nota para adicionar ao canvas…"
        query={query}
        onQuery={setQuery}
        items={results.map(({ item, match }) => ({
          key: item.path,
          content: (
            <>
              <span>
                <Highlight text={item.title} indices={match.indices} />
              </span>
              {item.path.includes('/') && <span style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>{item.path.slice(0, item.path.lastIndexOf('/'))}</span>}
            </>
          ),
        }))}
        empty="Nenhuma nota encontrada."
        onClose={onClose}
        onChoose={(i) => {
          const r = results[i]
          if (r) onPick(r.item.path)
          else onClose()
        }}
      />
    </div>
  )
}
