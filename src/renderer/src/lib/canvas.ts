/*
 * Modelo do canvas no formato aberto JSON Canvas 1.0 (jsoncanvas.org, MIT).
 * Usar um formato aberto mantém os arquivos legíveis por outros apps.
 *
 * Nós: text (texto Markdown), file (uma nota do cofre), link (URL) e group
 * (moldura com rótulo). Arestas ligam lados de dois nós.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type CanvasColor = '1' | '2' | '3' | '4' | '5' | '6' | string

interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
}

export interface TextNode extends NodeBase {
  type: 'text'
  text: string
}
export interface FileNode extends NodeBase {
  type: 'file'
  file: string
  subpath?: string
}
export interface LinkNode extends NodeBase {
  type: 'link'
  url: string
}
export interface GroupNode extends NodeBase {
  type: 'group'
  label?: string
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: 'none' | 'arrow'
  toNode: string
  toSide?: Side
  toEnd?: 'none' | 'arrow'
  color?: CanvasColor
  label?: string
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** Campos e nós que o Opalite não edita, guardados para regravar intactos. */
  extra?: { top: Record<string, unknown>; nodes: unknown[]; nodeFields: Record<string, Record<string, unknown>>; edgeFields: Record<string, Record<string, unknown>> }
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** Lê um .canvas tolerando campos ausentes ou inválidos (arquivos editados à mão). */
export function parseCanvas(text: string): CanvasData {
  let raw: unknown
  try {
    raw = text.trim() ? JSON.parse(text) : {}
  } catch {
    throw new Error('Este canvas não é um JSON válido.')
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as { nodes?: unknown; edges?: unknown; [k: string]: unknown }
  const { nodes: _n, edges: _e, ...top } = obj
  const extra: NonNullable<CanvasData['extra']> = { top, nodes: [], nodeFields: {}, edgeFields: {} }
  const KNOWN_NODE = new Set(['id', 'type', 'x', 'y', 'width', 'height', 'color', 'text', 'file', 'subpath', 'url', 'label'])
  const KNOWN_EDGE = new Set(['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label'])
  const unknownFields = (r: Record<string, unknown>, known: Set<string>) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) if (!known.has(k)) out[k] = v
    return Object.keys(out).length ? out : null
  }
  const nodes: CanvasNode[] = []
  for (const n of Array.isArray(obj.nodes) ? obj.nodes : []) {
    if (!n || typeof n !== 'object') continue
    const r = n as Record<string, unknown>
    const id = str(r['id'])
    if (!id) continue
    const extraFields = unknownFields(r, KNOWN_NODE)
    if (extraFields) extra.nodeFields[id] = extraFields
    if (!['text', 'file', 'link', 'group'].includes(String(r['type']))) {
      extra.nodes.push(n)
      continue
    }
    const base = { id, x: num(r['x'], 0), y: num(r['y'], 0), width: num(r['width'], 250), height: num(r['height'], 60), ...(str(r['color']) ? { color: str(r['color']) } : {}) }
    switch (r['type']) {
      case 'text':
        nodes.push({ ...base, type: 'text', text: str(r['text']) ?? '' })
        break
      case 'file':
        if (str(r['file'])) nodes.push({ ...base, type: 'file', file: str(r['file'])!, ...(str(r['subpath']) ? { subpath: str(r['subpath']) } : {}) })
        break
      case 'link':
        nodes.push({ ...base, type: 'link', url: str(r['url']) ?? '' })
        break
      case 'group':
        nodes.push({ ...base, type: 'group', ...(str(r['label']) ? { label: str(r['label']) } : {}) })
        break
    }
  }
  const ids = new Set(nodes.map((n) => n.id))
  const edges: CanvasEdge[] = []
  for (const e of Array.isArray(obj.edges) ? obj.edges : []) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const id = str(r['id'])
    const fromNode = str(r['fromNode'])
    const toNode = str(r['toNode'])
    if (!id || !fromNode || !toNode || !ids.has(fromNode) || !ids.has(toNode)) continue
    const extraEdge = unknownFields(r, KNOWN_EDGE)
    if (extraEdge) extra.edgeFields[id] = extraEdge
    const side = (v: unknown) => (SIDES.includes(v as Side) ? (v as Side) : undefined)
    edges.push({
      id,
      fromNode,
      toNode,
      ...(side(r['fromSide']) ? { fromSide: side(r['fromSide']) } : {}),
      ...(side(r['toSide']) ? { toSide: side(r['toSide']) } : {}),
      ...(r['fromEnd'] === 'arrow' ? { fromEnd: 'arrow' as const } : {}),
      ...(r['toEnd'] === 'none' ? { toEnd: 'none' as const } : {}),
      ...(str(r['color']) ? { color: str(r['color']) } : {}),
      ...(str(r['label']) ? { label: str(r['label']) } : {}),
    })
  }
  const hasExtra = Object.keys(top).length || extra.nodes.length || Object.keys(extra.nodeFields).length || Object.keys(extra.edgeFields).length
  return hasExtra ? { nodes, edges, extra } : { nodes, edges }
}

export function serializeCanvas(data: CanvasData): string {
  const { extra, nodes, edges } = data
  const out = {
    ...(extra?.top ?? {}),
    nodes: [...nodes.map((n) => ({ ...(extra?.nodeFields[n.id] ?? {}), ...n })), ...(extra?.nodes ?? [])],
    edges: edges.map((e) => ({ ...(extra?.edgeFields[e.id] ?? {}), ...e })),
  }
  return `${JSON.stringify(out, null, '\t')}\n`
}

export function newId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Ponto no meio de um lado do nó. */
export function anchor(node: NodeBase, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2 }
  }
}

/** Lado do nó mais próximo de um ponto. */
export function nearestSide(node: NodeBase, x: number, y: number): Side {
  let best: Side = 'top'
  let bestDist = Infinity
  for (const side of SIDES) {
    const a = anchor(node, side)
    const d = Math.hypot(a.x - x, a.y - y)
    if (d < bestDist) {
      best = side
      bestDist = d
    }
  }
  return best
}

/** Escolhe os lados que deixam a conexão mais curta entre dois nós. */
export function bestSides(a: NodeBase, b: NodeBase): [Side, Side] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  return [nearestSide(a, cb.x, cb.y), nearestSide(b, ca.x, ca.y)]
}

const DIR: Record<Side, [number, number]> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }

/** Curva de Bézier saindo perpendicular de cada lado (caminho SVG). */
export function edgePath(from: { x: number; y: number }, fromSide: Side, to: { x: number; y: number }, toSide: Side | null): string {
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const c = Math.max(40, Math.min(160, dist * 0.45))
  const [fx, fy] = DIR[fromSide]
  const [tx, ty] = toSide ? DIR[toSide] : [0, 0]
  return `M ${from.x} ${from.y} C ${from.x + fx * c} ${from.y + fy * c}, ${to.x + tx * c} ${to.y + ty * c}, ${to.x} ${to.y}`
}

/** Nós totalmente dentro de um grupo (movem junto com ele). */
export function nodesInside(group: NodeBase, nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter(
    (n) => n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height,
  )
}

/** Cores padrão do formato: 1 vermelho, 2 laranja, 3 amarelo, 4 verde, 5 ciano, 6 roxo. */
export const CANVAS_COLORS: Array<{ id: CanvasColor; label: string; css: string }> = [
  { id: '1', label: 'Vermelho', css: '#e5655f' },
  { id: '2', label: 'Laranja', css: '#ec9a52' },
  { id: '3', label: 'Amarelo', css: '#e4c454' },
  { id: '4', label: 'Verde', css: '#5fbf87' },
  { id: '5', label: 'Ciano', css: '#56b9c9' },
  { id: '6', label: 'Roxo', css: '#a688f0' },
]

export function colorCss(color: CanvasColor | undefined): string | null {
  if (!color) return null
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  return CANVAS_COLORS.find((c) => c.id === color)?.css ?? null
}
