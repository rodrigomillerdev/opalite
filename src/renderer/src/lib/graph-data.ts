import type { GraphData, GraphEdge, GraphNode } from '../../../shared/types'
import { normalizeText } from '../../../shared/text'

/*
 * Preparação dos dados do gráfico (funções puras, testáveis):
 * aplica os filtros escolhidos e, no gráfico local, mantém só a vizinhança
 * da nota atual até a profundidade pedida.
 */

export interface GraphSettings {
  search: string
  showTags: boolean
  showUnresolved: boolean
  showOrphans: boolean
  showCanvas: boolean
  colorBy: 'folder' | 'tag' | 'none'
  nodeSize: number
  linkWidth: number
  /** Zoom a partir do qual os nomes aparecem. */
  labelZoom: number
  repel: number
  linkDistance: number
  centerForce: number
  /** Profundidade do gráfico local. */
  depth: number
  /** Intensidade do halo dos nós (0 = sem brilho). */
  glow: number
  /** Fluxo animado nas conexões em destaque. */
  motion: boolean
  /** Pontos de fundo com paralaxe (sensação de profundidade). */
  stars: boolean
  /** Cores próprias ('' = seguir o tema). */
  nodeColor: string
  linkColor: string
  highlightColor: string
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: '',
  showTags: false,
  showUnresolved: false,
  showOrphans: true,
  showCanvas: true,
  colorBy: 'folder',
  nodeSize: 1,
  linkWidth: 1,
  labelZoom: 0.9,
  repel: 1,
  linkDistance: 70,
  centerForce: 0.06,
  depth: 1,
  glow: 0.7,
  motion: true,
  stars: true,
  nodeColor: '',
  linkColor: '',
  highlightColor: '',
}

export function filterGraph(data: GraphData, s: GraphSettings, center: string | null = null): GraphData {
  let nodes = data.nodes.filter(
    (n) =>
      (n.kind !== 'tag' || s.showTags) &&
      (n.kind !== 'unresolved' || s.showUnresolved) &&
      (n.kind !== 'canvas' || s.showCanvas),
  )
  const query = normalizeText(s.search.trim())
  if (query) {
    nodes = nodes.filter((n) => normalizeText(n.label).includes(query) || normalizeText(n.id).includes(query) || n.id === center)
  }
  let ids = new Set(nodes.map((n) => n.id))
  let edges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target))

  if (center) {
    const keep = neighborhood(center, edges, Math.max(1, Math.min(s.depth, 5)))
    nodes = nodes.filter((n) => keep.has(n.id))
    ids = new Set(nodes.map((n) => n.id))
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  } else if (!s.showOrphans) {
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]))
    nodes = nodes.filter((n) => linked.has(n.id))
  }
  return { nodes, edges }
}

/** Ids alcançáveis a partir de `center` em até `depth` passos. */
export function neighborhood(center: string, edges: GraphEdge[], depth: number): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const e of edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
    adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source])
  }
  const seen = new Set([center])
  let frontier = [center]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of adjacency.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          next.push(n)
        }
      }
    }
    frontier = next
  }
  return seen
}

/** Chave de grupo usada para colorir um nó. */
export function groupOf(node: GraphNode, colorBy: GraphSettings['colorBy']): string {
  if (colorBy === 'none') return ''
  if (colorBy === 'tag') return node.tags[0]?.split('/')[0] ?? ''
  return node.folder
}
